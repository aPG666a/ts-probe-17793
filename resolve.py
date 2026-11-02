#!/usr/bin/env python3
# DoH 解析三个 challenges 域，输出 shell 赋值行；失败用已知 CF 边缘 IP 兜底
import json, sys, urllib.request

NAMES = ["challenges.cloudflare.com", "brunhild.challenges.cloudflare.com", "hagen.challenges.cloudflare.com", "foxrouter.org"]
FALLBACK = {"challenges.cloudflare.com": "104.18.94.41",
            "brunhild.challenges.cloudflare.com": "104.18.8.208",
            "hagen.challenges.cloudflare.com": "104.18.9.208",
            "foxrouter.org": "172.67.188.160"}


def ask(url):
    req = urllib.request.Request(url, headers={"accept": "application/dns-json"})
    with urllib.request.urlopen(req, timeout=12) as r:
        d = json.load(r)
    for a in d.get("Answer", []):
        if a.get("type") == 1:
            return a["data"]
    return ""


def resolve(n):
    for u in ("https://1.1.1.1/dns-query?name=%s&type=A" % n,
              "https://dns.google/resolve?name=%s&type=A" % n):
        try:
            ip = ask(u)
        except Exception as e:
            print("# %s via %s ERR %s" % (n, u, e), file=sys.stderr)
            continue
        if ip:
            print("# %s -> %s (via %s)" % (n, ip, u), file=sys.stderr)
            return ip
    print("# %s -> FALLBACK %s" % (n, FALLBACK[n]), file=sys.stderr)
    return FALLBACK[n]


vals = [resolve(n) for n in NAMES]
print("CH=%s" % vals[0])
print("BR=%s" % vals[1])
print("HG=%s" % vals[2])
print("FR=%s" % vals[3])
for n, ip in zip(NAMES, vals):
    print("%s %s" % (ip, n))
