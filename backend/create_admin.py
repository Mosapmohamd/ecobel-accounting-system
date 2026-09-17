"""
Run once to create the first (and, per current scope, only-role) user:
    python create_admin.py <username> <password>
"""
import sys
from app.database import SessionLocal, engine
from app import models, auth

models.Base.metadata.create_all(bind=engine)


def main():
    if len(sys.argv) != 3:
        print("Usage: python create_admin.py <username> <password>")
        sys.exit(1)

    username, password = sys.argv[1], sys.argv[2]
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
