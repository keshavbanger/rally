from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

from app.core.config import settings
from app.models import Base  # noqa: F401 — imports every model onto Base.metadata

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def get_url() -> str:
    # Prefer the direct (session-mode) connection: Supabase's pgBouncer
    # transaction pooler (DATABASE_URL) does not support the prepared
    # statements that Alembic emits, causing "prepared statement already
    # exists" errors on the first migration run.
    url = settings.DIRECT_DATABASE_URL or settings.DATABASE_URL
    if not url:
        raise RuntimeError(
            "Neither DIRECT_DATABASE_URL nor DATABASE_URL is set. "
            "Copy backend/.env.example to backend/.env and fill in your "
            "Supabase connection strings before running migrations."
        )
    return url


def run_migrations_offline() -> None:
    context.configure(
        url=get_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    configuration = config.get_section(config.config_ini_section) or {}
    configuration["sqlalchemy.url"] = get_url()
    connectable = engine_from_config(
        configuration,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
