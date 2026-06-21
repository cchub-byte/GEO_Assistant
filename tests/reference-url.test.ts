import { describe, expect, it } from "vitest";
import { normalizeReferenceSourceUrl, resolveReferenceFetchUrl } from "@/lib/services/reference-url";

const zimgsImageProxyUrl =
  "https://s2.zimgs.cn/ims?at=smstruct&kt=url&key=aHR0cHM6Ly9jZG4uc20uY24vdGVtcC8yMDI1MTIwNDEwNDI1NC15NHE0NHYyYzh6Y3hvZW5hdWh2djV2N25yajBzOXNqdC53ZWJw&sign=yx:EyeNcHC3Z7PjfGXgtiVJoyGcZIs=&tv=0_0&p=";
const qianwenZimgsProxyUrl =
  "https://s2.zimgs.cn/ims?at=smstruct&kt=url&key=aHR0cHM6Ly93d3cucXVhbmZhbmd0b25nLm5ldC9hc3NldHMvaGV5Ym9zcy_kvIHkuJrlvq7kv6HmiKrlm75fMTcxNjU0ODc5MDExOTUxX0VHSmdxZkVPLnBuZw==&sign=yx:QeDmgwyrpF1wVjb1Jw_Zg8_y8M0=&tv=0_0&p=";

describe("reference URL normalization", () => {
  it("rejects zimgs search image proxy URLs when the decoded target is an image", () => {
    const resolution = resolveReferenceFetchUrl(zimgsImageProxyUrl);

    expect(resolution.url).toBe("https://cdn.sm.cn/temp/20251204104254-y4q44v2c8zcxoenauhvv5v7nrj0s9sjt.webp");
    expect(resolution.rejectedReason).toContain("搜索结果图片代理");
    expect(normalizeReferenceSourceUrl(zimgsImageProxyUrl)).toBe("https://cdn.sm.cn/temp/20251204104254-y4q44v2c8zcxoenauhvv5v7nrj0s9sjt.webp");
  });

  it("converts qianwen zimgs proxy URLs to the decoded original URL for source storage", () => {
    expect(normalizeReferenceSourceUrl(qianwenZimgsProxyUrl)).toBe(
      "https://www.quanfangtong.net/assets/heyboss/企业微信截图_171654879011951_EGJgqfEO.png"
    );

    const resolution = resolveReferenceFetchUrl(qianwenZimgsProxyUrl);
    expect(resolution.url).toBe("https://www.quanfangtong.net/assets/heyboss/企业微信截图_171654879011951_EGJgqfEO.png");
    expect(resolution.rejectedReason).toContain("搜索结果图片代理");
  });

  it("unwraps ordinary redirect query parameters", () => {
    expect(normalizeReferenceSourceUrl("https://example.com/redirect?target=https%3A%2F%2Fnews.example.org%2Farticle")).toBe(
      "https://news.example.org/article"
    );
  });
});
