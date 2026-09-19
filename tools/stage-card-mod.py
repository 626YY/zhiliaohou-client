"""把已编译、已验收的轮椅 DLL 放入客户端打包目录；只带 DLL 与公开摘要。"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--dll', default='C:/wheellive/mod/bin/Release/WheelLive.dll')
parser.add_argument('--version', required=True)
args = parser.parse_args()
source = Path(args.dll).resolve()
raw = source.read_bytes()
config = json.loads((root/'build/license-provider.json').read_text(encoding='utf-8'))
pin = config['modPublicKeys']['game:4wheel-challenge']
assert hashlib.sha256(pin['keyXml'].encode('utf-8')).hexdigest() == pin['fingerprint'], 'Public key fingerprint mismatch'
assert pin['keyXml'].encode('utf-16-le') in raw, 'DLL does not contain the pinned issuer public key'
assert args.version.encode('utf-16-le') in raw, 'DLL does not contain requested mod version'
target = root/'output/local-card-mod'
target.mkdir(parents=True, exist_ok=True)
shutil.copy2(source, target/'WheelLive.dll')
manifest = {'sha256': hashlib.sha256(raw).hexdigest(), 'fingerprint': pin['fingerprint'], 'version': args.version}
(target/'manifest.json').write_text(json.dumps(manifest, indent=2)+'\n', encoding='utf-8')
print('Staged verified public component', args.version, manifest['sha256'])
