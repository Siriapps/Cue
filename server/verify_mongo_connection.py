import os
import sys
import certifi
from pymongo import MongoClient
from dotenv import load_dotenv

# Load .env from current directory (expected to be server/)
load_dotenv()

uri = os.getenv("MONGODB_URI")
if not uri:
    print("MONGODB_URI not found in environment.")
    sys.exit(1)

print(f"Connecting to MongoDB...")
try:
    # Use the same secure configuration as the app
    client = MongoClient(
        uri, 
        tls=True, 
        tlsCAFile=certifi.where(),
        serverSelectionTimeoutMS=5000
    )
    # The ismaster command is cheap and checks connection.
    client.admin.command('ismaster')
    print("SUCCESS: Connection established and authenticated.")
except Exception as e:
    print(f"FAILURE: Could not connect to MongoDB.")
    print(f"Error: {e}")
    sys.exit(1)
