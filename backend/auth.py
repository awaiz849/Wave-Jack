"""
Who is calling? Verifies the Supabase access token sent as
`Authorization: Bearer <access_token>`.

The token is checked by Supabase's auth server (GET /auth/v1/user) instead of
being decoded locally. That works whichever signing keys the project uses
(legacy JWT secret or the newer asymmetric keys), needs no extra secret here,
and also rejects sessions that were signed out or users that were deleted.
It costs one request per call, which is fine: only admin routes use it.
"""

from dataclasses import dataclass

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from supabase_auth.errors import AuthApiError

from config import ADMIN_EMAILS
from database import get_client

_bearer = HTTPBearer(auto_error=False)
_CHALLENGE = {"WWW-Authenticate": "Bearer"}


@dataclass(frozen=True)
class CurrentUser:
    id: str
    email: str
    email_confirmed: bool


def require_user(creds: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> CurrentUser:
    if creds is None or not creds.credentials:
        raise HTTPException(401, "Sign in required", headers=_CHALLENGE)
    try:
        res = get_client().auth.get_user(creds.credentials)
    except AuthApiError as e:
        if (e.status or 0) >= 500:
            raise HTTPException(503, "Couldn't verify your session right now. Try again.") from e
        raise HTTPException(401, "Your session is invalid or has expired. Sign in again.", headers=_CHALLENGE) from e
    except Exception as e:  # network trouble, misconfigured Supabase, ...
        print(f"auth: token verification failed: {type(e).__name__}: {e}")
        raise HTTPException(503, "Couldn't verify your session right now. Try again.") from e

    user = res.user if res else None
    if user is None:
        raise HTTPException(401, "Your session is invalid or has expired. Sign in again.", headers=_CHALLENGE)
    return CurrentUser(
        id=str(user.id),
        email=(user.email or "").lower(),
        email_confirmed=user.email_confirmed_at is not None,
    )


def require_admin(user: CurrentUser = Depends(require_user)) -> CurrentUser:
    if not ADMIN_EMAILS:
        raise HTTPException(403, "Admin access isn't configured on this server (set ADMIN_EMAILS).")
    # Unconfirmed addresses don't count: otherwise anyone could sign up as the
    # admin's email (if that address hadn't registered yet) and walk in.
    if user.email not in ADMIN_EMAILS or not user.email_confirmed:
        raise HTTPException(403, "This action is for admins only.")
    return user
