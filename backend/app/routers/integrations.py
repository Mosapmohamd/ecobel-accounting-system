"""Settings → Integrations (staff). The rules and limits are in
app/integrations.py and docs/INTEGRATIONS.md."""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import auth, integrations, schemas
from ..database import get_db

router = APIRouter(prefix="/integrations", tags=["Integrations"], dependencies=[Depends(auth.get_current_user)])

# The last on-demand storefront check, kept in this process's memory only
# (gone on restart; never stored): it's a live probe, not a history.
_last_check: dict | None = None


@router.get("/meta-pixel", response_model=schemas.MetaPixelStatus)
def meta_pixel_status(db: Session = Depends(get_db)):
    return schemas.MetaPixelStatus(
        storefront_url=integrations.storefront_url(),
        last_check=_last_check,
        events=integrations.EVENTS,
        purchase_eligible=integrations.purchase_eligible(db),
        browser_events_measured=False,
        meta_received_measured=False,
        events_manager_url=integrations.EVENTS_MANAGER_URL,
    )


@router.post("/meta-pixel/check", response_model=schemas.StorefrontCheck)
def run_meta_pixel_check():
    """Fetches the configured storefront once (no request-supplied URL)."""
    global _last_check
    _last_check = integrations.check_storefront(integrations.storefront_url())
    return _last_check
