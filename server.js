import puppeteer from "puppeteer";
import axios from "axios";
import fs from "fs";

// Regex for matching colors in CSS text
const colorRegex = /(#[0-9a-f]{3,6}\b|rgba?\([^)]+\)|hsla?\([^)]+\))/gi;

async function crawlColorsAndCSS(url) {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: "networkidle2" });

  // 1. Extract computed colors from DOM
  const computedColors = await page.evaluate(() => {
    const colorProps = [
      "color",
      "backgroundColor",
      "borderColor",
      "outlineColor",
      "fill",
      "stroke"
    ];
    const uniqueColors = new Set();

    document.querySelectorAll("*").forEach(el => {
      const styles = window.getComputedStyle(el);
      colorProps.forEach(prop => {
        const value = styles.getPropertyValue(prop);
        if (
          value &&
          value !== "rgba(0, 0, 0, 0)" &&
          value !== "transparent"
        ) {
          uniqueColors.add(value.trim());
        }
      });
    });

    return Array.from(uniqueColors);
  });

  // 2. Extract CSS links and inline <style> blocks
  const { cssLinks, inlineCSS } = await page.evaluate(() => {
    const links = Array.from(
      document.querySelectorAll("link[rel='stylesheet']")
    ).map(link => link.href);

    const styles = Array.from(document.querySelectorAll("style")).map(
      s => s.textContent
    );

    return { cssLinks: links, inlineCSS: styles };
  });

  // 3. Fetch external CSS files
  let cssTexts = [...inlineCSS];
  for (const link of cssLinks) {
    try {
      const res = await fetch(link).then(r => r.text());
      cssTexts.push(res);
    } catch (e) {
      console.warn("⚠️ Failed to load CSS:", link);
    }
  }

  // 4. Extract colors from all CSS text
  let cssColors = new Set();
  cssTexts.forEach(css => {
    const matches = css.match(colorRegex);
    if (matches) matches.forEach(c => cssColors.add(c));
  });

  await browser.close();

  return {
    computedColors: Array.from(computedColors),
    cssColors: Array.from(cssColors),
  };
}

const url = "https://bemidas.com/"; 
crawlColorsAndCSS(url).then(result => {
  console.log("✅ Crawling done! Saving to colors.json");

  // Save results in a JSON file
  fs.writeFileSync("colors.json", JSON.stringify(result, null, 2));

  console.log("📁 Results saved in colors.json");
});
