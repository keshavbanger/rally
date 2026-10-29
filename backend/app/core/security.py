"""
JWT verification compatible with Supabase Auth.

FastAPI never issues its own tokens in this architecture — Supabase Auth
handles signup/login/password storage entirely on the frontend via
supabase-js. This module only *verifies* the JWT Supabase already issued.

Two verification paths, selected by the token's own (untrusted, but
allow-listed) `alg` header — never by anything the caller asserts:

- HS256, the shared-secret path — `JWT_SECRET` (Settings > API > JWT
  Secret in the Supabase dashboard). This is what every project created
  before Supabase's JWT Signing Keys rollout uses, and what the test
  suite's locally-signed tokens always use (see tests/conftest.py).
- ES256/RS256, the asymmetric path — newer Supabase projects (JWT
  Signing Keys enabled) sign tokens with a private key and publish the
  matching PUBLIC key at `{SUPABASE_URL}/auth/v1/.well-known/jwks.json`.
  There is no shared secret to configure for these at all; verification
  fetches that public key (cached) instead.

Gating which key material is used strictly by an allow-listed `alg`
(never blindly trusting the header) avoids the classic algorithm-
confusion attack — an HS256 token can never be checked against the
JWKS-published public key, and an ES256/RS256 token can never be checked
against JWT_SECRET.
"""

import logging
import ssl
from typing import Optional

import certifi
import jwt
from jwt import PyJWKClient, PyJWTError

from app.core.config import settings

logger = logging.getLogger("rally.security")

_jwk_client: Optional[PyJWKClient] = None


def _get_jwk_client(supabase_url: str) -> PyJWKClient:
    global _jwk_client
    if _jwk_client is None:
        ssl_ctx = ssl.create_default_context(cafile=certifi.where())
        jwks_url = f"{supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json"
        _jwk_client = PyJWKClient(jwks_url, ssl_context=ssl_ctx)
    return _jwk_client


class InvalidTokenError(Exception):
    pass


def decode_supabase_jwt(token: str) -> dict:
    """Verifies signature, expiry, audience, and (when SUPABASE_URL is
    configured) issuer, then returns the decoded claims. Supports both
    asymmetric Supabase signing (ES256 / RS256 via JWKS) and legacy/local
    symmetric signing (HS256 with JWT_SECRET).

    Raises InvalidTokenError on any failure — callers should turn that into
    a 401, not leak the underlying jwt library exception to the client.
    """
    try:
        header = jwt.get_unverified_header(token)
    except Exception as exc:
        raise InvalidTokenError("Malformed token header.") from exc

    alg = header.get("alg", settings.JWT_ALGORITHM)

    decode_kwargs: dict = {}
    if settings.SUPABASE_URL:
        # Supabase issues tokens with iss=<project-url>/auth/v1. Only
        # enforced when SUPABASE_URL is set, so local/test setups that
        # don't have a real project configured aren't forced to fake one.
        decode_kwargs["issuer"] = f"{settings.SUPABASE_URL.rstrip('/')}/auth/v1"

    try:
        if alg in ("ES256", "RS256") and settings.SUPABASE_URL:
            jwk_client = _get_jwk_client(settings.SUPABASE_URL)
            signing_key = jwk_client.get_signing_key_from_jwt(token)
            payload = jwt.decode(
                token,
                signing_key.key,
                algorithms=[alg],
                audience="authenticated",
                **decode_kwargs,
            )
        else:
            if not settings.JWT_SECRET:
                raise InvalidTokenError("JWT_SECRET is not configured on the server.")
            payload = jwt.decode(
                token,
                settings.JWT_SECRET,
                algorithms=[settings.JWT_ALGORITHM],
                audience="authenticated",
                **decode_kwargs,
            )
    except PyJWTError as exc:
        logger.info("JWT verification failed: %s - %s", exc.__class__.__name__, str(exc))
        raise InvalidTokenError("Invalid or expired token.") from exc
    except Exception as exc:
        logger.info("JWT verification failed with unexpected error: %s - %s", exc.__class__.__name__, str(exc))
        raise InvalidTokenError("Invalid or expired token.") from exc

    if not payload.get("sub"):
        raise InvalidTokenError("Token is missing a subject claim.")

    return payload


def get_user_id_from_token(token: str) -> str:
    """Returns the Supabase auth user id (the JWT `sub` claim)."""
    payload = decode_supabase_jwt(token)
    return payload["sub"]


def extract_profile_hints(claims: dict) -> tuple[Optional[str], Optional[str]]:
    """Pulls optional (full_name, avatar_url) hints out of Supabase's
    `user_metadata` claim, for use ONLY when first creating a profile.
    Metadata is user-supplied at signup and not guaranteed to exist or to
    use any particular key, so every lookup here is a soft fallback."""
    metadata = claims.get("user_metadata")
    if not isinstance(metadata, dict):
        return None, None

    full_name = metadata.get("full_name") or metadata.get("name")
    avatar_url = metadata.get("avatar_url") or metadata.get("picture")
    return full_name, avatar_url
