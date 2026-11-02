#!/usr/bin/env python3
import json, sys, urllib.request
n = sys.argv[1]
for u in ("https://1.1.1.1/dns-query?name=%s&type=A" % n, "https://dns.google/resolve?name=%s&type=A" % n):
    try:
        r = urllib.request.Request(u, headers={"accept": "application/dns-json"})
        d = json.load(urllib.request.urlopen(r, timeout=10))
        a = [x["data"] for x in d.get("Answer", []) if x.get("type") == 1]
        if a:
            print(a[0]); sys.exit(0)
    except Exception:
        pass
print("")
