import json
import hashlib
import base64
import requests
import sys

def compute_hash_sha256_base64(url):
    resp = requests.get(url, stream=True)
    sha256 = hashlib.sha256()
    for chunk in resp.iter_content(8192):
        sha256.update(chunk)
    digest = base64.b64encode(sha256.digest()).decode()
    return f"sha256-{digest}"

if len(sys.argv) < 3:
    print("Usage: python script.py <input.json> <output.json>")
    sys.exit(1)

input_filename = sys.argv[1]
output_filename = sys.argv[2]

with open(input_filename, 'r') as f:
    data = json.load(f)

update_needed = False
for a_key, a_val in data.items():
    for b_key, b_val in a_val.items():
        if 'hash' not in b_val:
            url = b_val.get('url')
            if url:
                b_val['hash'] = compute_hash_sha256_base64(url)
                update_needed = True

if update_needed:
    with open(output_filename, 'w') as out_f:
        json.dump(data, out_f, indent=2)

print('Processing complete. Updated file written to output.json')
