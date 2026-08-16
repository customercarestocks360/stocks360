from pydantic import BaseModel, ConfigDict, EmailStr, Field


class SignupRequest(BaseModel):
    """Email/password registration. Firebase enforces a 6-char minimum password."""

    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    email: EmailStr = Field(examples=["you@example.com"])
    # Upper bound guards against a client posting a megabyte of "password".
    password: str = Field(min_length=6, max_length=128, examples=["hunter2secret"])
    display_name: str | None = Field(default=None, min_length=1, max_length=128)


class TokenRequest(BaseModel):
    """A Firebase ID token obtained client-side via the Web SDK."""

    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    # A JWT is header.payload.signature, so anything short is malformed by definition.
    id_token: str = Field(min_length=20, max_length=8192)


class UserResponse(BaseModel):
    """Identity as asserted by Firebase, straight from the verified token or user record."""

    uid: str
    email: str | None = None
    name: str | None = None
    picture: str | None = None
    provider: str | None = Field(default=None, examples=["password", "google.com"])
    email_verified: bool = False

    @classmethod
    def from_claims(cls, claims: dict) -> "UserResponse":
        return cls(
            uid=claims["uid"],
            email=claims.get("email"),
            name=claims.get("name"),
            picture=claims.get("picture"),
            provider=claims.get("firebase", {}).get("sign_in_provider"),
            email_verified=bool(claims.get("email_verified", False)),
        )

    @classmethod
    def from_user_record(cls, user) -> "UserResponse":
        # UserRecord.provider_id is always "firebase"; the real provider lives in provider_data.
        providers = [p.provider_id for p in (user.provider_data or [])]
        return cls(
            uid=user.uid,
            email=user.email,
            name=user.display_name,
            picture=user.photo_url,
            provider=providers[0] if providers else None,
            email_verified=bool(user.email_verified),
        )


class FirebaseWebConfig(BaseModel):
    """Firebase Web SDK config handed to the browser. Field names are camelCase
    because the SDK's initializeApp() expects exactly these keys."""

    apiKey: str
    authDomain: str
    projectId: str
    storageBucket: str
    messagingSenderId: str
    appId: str
    measurementId: str | None = None
