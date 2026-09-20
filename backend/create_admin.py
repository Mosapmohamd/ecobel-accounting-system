"""
Run once (after `alembic upgrade head`) to create the first (and, per
current scope, only-role) user:

    python create_admin.py <username>

You'll be prompted for the password so it never appears in shell history
or process listings (e.g. `ps aux`). For scripted/CI use where a prompt
isn't possible, you may still pass the password as a second argument —
just be aware it will be visible in shell history and process listings
on that machine.
"""
import sys
import getpass

from app.database import SessionLocal
from app import models, auth


def main():
    if len(sys.argv) not in (2, 3):
        print("Usage: python create_admin.py <username> [password]")
        print("       (omit password to be prompted securely)")
        sys.exit(1)

    username = sys.argv[1]
    if len(sys.argv) == 3:
        password = sys.argv[2]
        print("Warning: passing the password as a CLI argument leaves it visible "
              "in shell history and process listings. Omit it to be prompted instead.",
              file=sys.stderr)
    else:
        password = getpass.getpass("Password: ")
        confirm = getpass.getpass("Confirm password: ")
        if password != confirm:
            print("Passwords don't match.", file=sys.stderr)
            sys.exit(1)

    if not password:
        print("Password can't be empty.", file=sys.stderr)
        sys.exit(1)

    db = SessionLocal()
    try:
        existing = db.query(models.User).filter(models.User.username == username).first()
        if existing:
            print(f"User '{username}' already exists.")
            return
        user = models.User(username=username, hashed_password=auth.hash_password(password))
        db.add(user)
        db.commit()
        print(f"Created user '{username}'.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
