import { expect, test } from "@playwright/test";
import path from "node:path";

const VIEWPORTS = [
  { width: 375, height: 667 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
];

test("consent sheet keeps Allow and Not now on screen", async ({ page }) => {
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await page.goto("/dev/location-consent");
    const allow = page.getByRole("button", { name: "Allow" });
    const notNow = page.getByRole("button", { name: "Not now" });
    await expect(allow).toBeVisible();
    await expect(notNow).toBeVisible();

    const boxes = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll("button")];
      const allowButton = buttons.find((button) => button.textContent?.trim() === "Allow");
      const notNowButton = buttons.find((button) => button.textContent?.trim() === "Not now");
      const copy = document.getElementById("location-consent-copy");
      const heading = document.getElementById("location-consent-title");
      if (!allowButton || !notNowButton || !copy || !heading) return null;
      const allowBox = allowButton.getBoundingClientRect();
      const notNowBox = notNowButton.getBoundingClientRect();
      const allowStyle = getComputedStyle(allowButton);
      const notNowStyle = getComputedStyle(notNowButton);
      return {
        scrollY: window.scrollY,
        viewportHeight: window.innerHeight,
        viewportWidth: window.innerWidth,
        allow: { top: allowBox.top, bottom: allowBox.bottom, height: allowBox.height, width: allowBox.width },
        notNow: { top: notNowBox.top, bottom: notNowBox.bottom, height: notNowBox.height, width: notNowBox.width },
        allowFont: allowStyle.fontSize,
        notNowFont: notNowStyle.fontSize,
        allowBg: allowStyle.backgroundColor,
        notNowBg: notNowStyle.backgroundColor,
        notNowColor: notNowStyle.color,
        notNowOpacity: notNowStyle.opacity,
        notNowBorder: notNowStyle.borderTopWidth,
        headingFont: getComputedStyle(heading).fontSize,
        copyFont: getComputedStyle(copy).fontSize,
        copyText: copy.textContent ?? "",
      };
    });

    expect(boxes, `sheet measurements at ${viewport.width}x${viewport.height}`).not.toBeNull();
    const measured = boxes!;
    expect(measured.scrollY).toBe(0);
    expect(measured.viewportWidth).toBe(viewport.width);
    expect(measured.viewportHeight).toBe(viewport.height);
    expect(measured.allow.top).toBeGreaterThanOrEqual(0);
    expect(measured.notNow.top).toBeGreaterThanOrEqual(0);
    expect(measured.allow.bottom).toBeLessThanOrEqual(viewport.height);
    expect(measured.notNow.bottom).toBeLessThanOrEqual(viewport.height);
    expect(measured.allow.height).toBe(measured.notNow.height);
    expect(measured.allow.width).toBe(measured.notNow.width);
    expect(measured.allow.width).toBeGreaterThan(viewport.width * 0.7);
    expect(measured.allowFont).toBe("16px");
    expect(measured.notNowFont).toBe("16px");
    expect(measured.headingFont).toBe("24px");
    expect(measured.allowBg).not.toBe(measured.notNowBg);
    expect(measured.notNowColor).not.toBe(measured.notNowBg);
    expect(measured.notNowOpacity).toBe("1");
    expect(Number.parseFloat(measured.notNowBorder)).toBeGreaterThanOrEqual(2);
    expect(measured.copyFont).toBe("16px");
    expect(measured.copyText).toContain(
      "Separately, if location is turned on for TidyWise in your phone or browser settings, your location is recorded when you clock in or out and when you take job photos.",
    );

    await page.screenshot({
      path: path.join("e2e", "artifacts", `location-consent-sheet-${viewport.width}x${viewport.height}.png`),
      fullPage: false,
    });
  }
});
