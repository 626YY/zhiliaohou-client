# -*- coding: utf-8 -*-
"""客户端发布后全量 HTTP 回读：安装包 SHA256/SHA512、blockmap、latest.yml 与旧入口跳转。"""
import base64
import hashlib
import json
import pathlib
import re
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
VERSION = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version']
RELEASE = ROOT / 'release' / ('v' + VERSION)
BASE = 'https://zhiliaohou.oss-cn-beijing.aliyuncs.com/updates/'
NAME = '知了猴整蛊台-Setup-' + VERSION + '.exe'


def get(name):
    with urllib.request.urlopen(BASE + urllib.parse.quote(name), timeout=60) as response:
        return response.read()


def main():
    local_yaml = (RELEASE / 'latest.yml').read_bytes()
    remote_yaml = get('latest.yml')
    assert remote_yaml == local_yaml, '远端 latest.yml 与本地不一致'
    text = remote_yaml.decode('utf-8')
    assert re.search(r'^version:\s*' + re.escape(VERSION) + r'\s*$', text, re.M)
    expected_sha512 = re.search(r'^sha512:\s*(\S+)\s*$', text, re.M).group(1)
    local256, local512 = hashlib.sha256(), hashlib.sha512()
    with (RELEASE / NAME).open('rb') as source:
        for chunk in iter(lambda: source.read(1 << 20), b''):
            local256.update(chunk)
            local512.update(chunk)
    assert base64.b64encode(local512.digest()).decode() == expected_sha512, '清单 SHA512 与本地安装包不符'
    remote256, remote512, size = hashlib.sha256(), hashlib.sha512(), 0
    with urllib.request.urlopen(BASE + urllib.parse.quote(NAME), timeout=120) as response:
        for chunk in iter(lambda: response.read(1 << 20), b''):
            remote256.update(chunk)
            remote512.update(chunk)
            size += len(chunk)
    assert size == (RELEASE / NAME).stat().st_size, 'HTTP 下载长度不符'
    assert remote256.digest() == local256.digest(), 'HTTP 全量 SHA256 不符'
    assert remote512.digest() == local512.digest(), 'HTTP 全量 SHA512 不符'
    assert get(NAME + '.blockmap') == (RELEASE / (NAME + '.blockmap')).read_bytes(), 'blockmap 不一致'
    with urllib.request.urlopen('http://47.251.93.171:8770/updates/latest.yml', timeout=45) as response:
        assert response.geturl().startswith(BASE), '旧入口未跳转到 OSS'
        assert response.read() == remote_yaml, '旧入口清单不同步'
        redirected = response.geturl()
    result = dict(version=VERSION, size=size, sha256=local256.hexdigest(), sha512=expected_sha512,
                  url=BASE + urllib.parse.quote(NAME), legacy_redirect=redirected,
                  latest_equal=True, blockmap_equal=True, full_download_equal=True)
    (RELEASE / '校验结果.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print('PASS 安装包 HTTP 全量回读：%d B，SHA256/SHA512 与本地及清单一致' % size)
    print('PASS blockmap / latest.yml 逐字节一致；旧服务器入口跳转 OSS 且清单同步')
    print('SHA256 ' + local256.hexdigest())


if __name__ == '__main__':
    main()
