// FE-1: API errors shown to staff (src/lib/apiError.ts). Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiErrorMessage, validationMessages } from '../src/lib/apiError.ts';

const axiosError = (status, data) => ({ isAxiosError: true, response: { status, data } });

test('our own Arabic messages are shown as they are', () => {
  const err = axiosError(409, { detail: 'الكوبون ده اتستخدم في 2 طلب فمينفعش يتمسح' });
  assert.equal(apiErrorMessage(err, 'fallback'), 'الكوبون ده اتستخدم في 2 طلب فمينفعش يتمسح');
});

test('a 422 list becomes field: reason lines instead of the generic message', () => {
  const err = axiosError(422, {
    detail: [
      { type: 'value_error', loc: ['body', 'name'], msg: 'Value error, اسم الروتين مطلوب', input: ' ', ctx: { error: {} } },
      { type: 'greater_than', loc: ['body', 'amount'], msg: 'Input should be greater than 0', input: 0, ctx: { gt: 0 } },
    ],
  });
  assert.equal(apiErrorMessage(err, 'حصل خطأ'), 'الاسم: اسم الروتين مطلوب — المبلغ: لازم يكون أكبر من 0');
});

test('common pydantic types are translated, nested item fields are named', () => {
  assert.deepEqual(validationMessages([
    { type: 'missing', loc: ['body', 'category'], msg: 'Field required' },
    { type: 'string_too_long', loc: ['body', 'name'], msg: 'String should have at most 200 characters', ctx: { max_length: 200 } },
    { type: 'greater_than', loc: ['body', 'items', 1, 'quantity'], msg: 'Input should be greater than 0', ctx: { gt: 0 } },
    { type: 'literal_error', loc: ['body', 'source'], msg: "Input should be 'website', 'b2b' or 'spending'" },
    { type: 'less_than_equal', loc: ['body', 'discount_percentage'], msg: 'x', ctx: { le: 100 } },
  ]), ['الفئة: مطلوب', 'الاسم: الحد الأقصى 200 حرف', 'الكمية: لازم يكون أكبر من 0', 'القسم: اختيار غير صالح', 'نسبة الخصم: لازم يكون 100 أو أقل']);
});

test('unknown fields and types still give a readable line; duplicates are merged', () => {
  assert.deepEqual(validationMessages([
    { type: 'some_new_type', loc: ['body', 'mystery_field'], msg: 'Something internal' },
    { type: 'some_new_type', loc: ['body', 'mystery_field'], msg: 'Something internal' },
  ]), ['قيمة غير صالحة']);
});

test('never shows raw server output: 500s, HTML pages, network errors and odd shapes fall back', () => {
  assert.equal(apiErrorMessage(axiosError(500, 'Internal Server Error\nTraceback (most recent call last): ...'), 'تعذر الحفظ'), 'تعذر الحفظ');
  assert.equal(apiErrorMessage(axiosError(500, { detail: { trace: 'x' } }), 'تعذر الحفظ'), 'تعذر الحفظ');
  assert.equal(apiErrorMessage(axiosError(400, { detail: '   ' }), 'تعذر الحفظ'), 'تعذر الحفظ');
  assert.equal(apiErrorMessage(new Error('Network Error'), 'تعذر الاتصال'), 'تعذر الاتصال');
  assert.equal(apiErrorMessage(undefined, 'تعذر'), 'تعذر');
  assert.equal(apiErrorMessage(axiosError(422, { detail: [] }), 'تعذر'), 'تعذر');
});

test('the result is always a string (safe to render in React)', () => {
  const out = apiErrorMessage(axiosError(422, { detail: [{ loc: ['body', 'name'] }, null, 7] }), 'x');
  assert.equal(typeof out, 'string');
});
