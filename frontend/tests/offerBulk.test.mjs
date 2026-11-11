// Several sale prices at once (src/pages/offers/bulkSalePrice.ts). Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSaleSnapshot, runBulk, confirmCreated, confirmNotCreated, knownFrom, IncompleteSnapshot } from '../src/pages/offers/bulkSalePrice.ts';

const row = (id, productId) => ({ source: 'product_offer', id, name: 't', type: 'product_price', config: { product_id: productId, offer_price: 10 } });

/** A fake /promotions list (type product_price) over a mutable store. */
function server(initial = []) {
  const store = [...initial];
  let nextId = 1;
  const listPage = async (offset, limit) => ({ items: store.slice(offset, offset + limit), total: store.length });
  const add = (productId) => {
    const r = row(`new${nextId++}`, productId);
    store.push(r);
    return r;
  };
  return { store, listPage, add };
}
const item = (productId) => ({ productId, productName: productId, status: 'pending', payload: { product_id: productId, title: 't', offer_price: 10, expires_at: null, is_active: false } });
const lost = () => Object.assign(new Error('Network Error'), { isAxiosError: true });
const rejected = (msg) => Object.assign(new Error(msg), { response: { status: 400, data: { detail: msg } } });
const deps = (s, create) => ({ create, listPage: s.listPage, messageOf: (e) => e.response?.data?.detail ?? 'خطأ' });

test('the snapshot reads every page, by product_id', async () => {
  const s = server(Array.from({ length: 250 }, (_, i) => row(`o${i}`, `p${i % 7}`)));
  const snap = await loadSaleSnapshot(s.listPage);
  assert.equal(snap.rows.size, 250);
  assert.equal(snap.byProduct.get('p0').size, 36);
});

test('an incomplete snapshot is refused: a failing page, a moving total, missing rows', async () => {
  const s = server(Array.from({ length: 150 }, (_, i) => row(`o${i}`, 'p')));
  const failing = async (offset, limit) => { if (offset > 0) throw new Error('boom'); return s.listPage(offset, limit); };
  await assert.rejects(loadSaleSnapshot(failing), IncompleteSnapshot);
  let calls = 0;
  const moving = async (offset, limit) => ({ ...(await s.listPage(offset, limit)), total: 150 + calls++ });
  await assert.rejects(loadSaleSnapshot(moving), IncompleteSnapshot);
  const short = async (offset, limit) => ({ items: offset ? [] : (await s.listPage(offset, limit)).items, total: 150 });
  await assert.rejects(loadSaleSnapshot(short), IncompleteSnapshot);
});

test('created items are never sent again; rejected ones are retried', async () => {
  const s = server();
  const sent = [];
  let fail = true;
  const create = async (p) => {
    sent.push(p.product_id);
    if (p.product_id === 'b' && fail) throw rejected('المنتج ده عليه عرض شغال بالفعل');
    return s.add(p.product_id);
  };
  const known = knownFrom(await loadSaleSnapshot(s.listPage));
  let items = await runBulk([item('a'), item('b')], deps(s, create), known, () => {});
  assert.deepEqual(items.map((i) => i.status), ['created', 'rejected']);
  assert.match(items[1].message, /عرض شغال/);
  fail = false;
  items = await runBulk(items, deps(s, create), known, () => {});
  assert.deepEqual(sent, ['a', 'b', 'b']);
  assert.deepEqual(items.map((i) => i.status), ['created', 'created']);
});

test('a lost answer with nothing new on the server → not created, may be retried', async () => {
  const s = server([row('old', 'a')]);
  const known = knownFrom(await loadSaleSnapshot(s.listPage));
  const items = await runBulk([item('a')], deps(s, async () => { throw lost(); }), known, () => {});
  assert.equal(items[0].status, 'not_created');
});

test('a lost answer with a matching new offer stays unresolved and is never retried automatically', async () => {
  const s = server([row('old', 'a')]);
  const known = knownFrom(await loadSaleSnapshot(s.listPage));
  let calls = 0;
  const create = async (p) => { calls++; s.add(p.product_id); throw lost(); }; // saved, answer lost
  let items = await runBulk([item('a')], deps(s, create), known, () => {});
  assert.equal(items[0].status, 'unresolved');
  assert.equal(items[0].candidates.length, 1);
  items = await runBulk(items, deps(s, create), known, () => {});
  assert.equal(calls, 1);
  assert.equal(s.store.filter((r) => r.config.product_id === 'a').length, 2);
  const yes = confirmCreated(items, 'a');
  assert.equal(yes[0].status, 'created');
  assert.equal((await runBulk(yes, deps(s, create), known, () => {}))[0].status, 'created');
  assert.equal(calls, 1);
});

test('unresolved when the check itself fails or finds several; "not mine" makes it retryable by hand only', async () => {
  const s = server();
  const known = knownFrom(await loadSaleSnapshot(s.listPage));
  const brokenList = async () => { throw new Error('down'); };
  let items = await runBulk([item('a')], { create: async () => { throw lost(); }, listPage: brokenList, messageOf: () => '' }, known, () => {});
  assert.equal(items[0].status, 'unresolved');
  assert.deepEqual(items[0].candidates, []);

  s.add('b'); s.add('b');
  const more = await runBulk([item('b')], deps(s, async () => { throw lost(); }), known, () => {});
  assert.equal(more[0].status, 'unresolved');
  assert.equal(more[0].candidates.length, 2);
  const no = confirmNotCreated(more, 'b', known);
  assert.equal(no[0].status, 'not_created');
  assert.equal(known.get('b').size, 2); // the candidates are now "not hers"
  const again = await runBulk(no, deps(s, async (p) => s.add(p.product_id)), known, () => {});
  assert.equal(again[0].status, 'created');
});

test('a 5xx is treated as a lost answer (it may have been saved)', async () => {
  const s = server();
  const known = knownFrom(await loadSaleSnapshot(s.listPage));
  const items = await runBulk([item('a')], deps(s, async (p) => { s.add(p.product_id); throw Object.assign(new Error('x'), { response: { status: 502 } }); }), known, () => {});
  assert.equal(items[0].status, 'unresolved');
});
