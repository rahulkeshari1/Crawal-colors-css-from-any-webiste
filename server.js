const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Regex for matching colors in CSS text
const colorRegex = /(#[0-9a-f]{3,6}\b|rgba?\([^)]+\)|hsla?\([^)]+\))/gi;

// Function to extract colors from a given URL with element mapping
async function crawlColorsAndCSS(url) {
  const browser = await puppeteer.launch({ 
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  
  await page.goto(url, { 
    waitUntil: "networkidle2",
    timeout: 30000
  });

  // 1. Extract computed colors from DOM with element information
  const elementColors = await page.evaluate(() => {
    const colorProps = [
      "color",
      "backgroundColor",
      "borderColor",
      "outlineColor",
      "fill",
      "stroke"
    ];
    
    const colorData = [];
    const processedElements = new Set();
    
    document.querySelectorAll("*").forEach(el => {
      // Skip elements that are too generic or have no visual representation
      if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.tagName === 'META' || 
          el.tagName === 'LINK' || el.tagName === 'HEAD') {
        return;
      }
      
      const tag = el.tagName.toLowerCase();
      const id = el.id ? `#${el.id}` : '';
const classes = el.classList && el.classList.length > 0 
  ? `.${[...el.classList].join('.')}` 
  : '';
        const selector = `${tag}${id}${classes}`;
      
      // Create a unique identifier for this element to avoid duplicates
      const elementIdentifier = el.outerHTML.length < 100 ? el.outerHTML : selector;
      
      if (processedElements.has(elementIdentifier)) return;
      processedElements.add(elementIdentifier);
      
      const styles = window.getComputedStyle(el);
      const elementColors = {};
      
      colorProps.forEach(prop => {
        const value = styles.getPropertyValue(prop);
        if (value && value !== "rgba(0, 0, 0, 0)" && value !== "transparent" && !value.includes("url")) {
          elementColors[prop] = value.trim();
        }
      });
      
      if (Object.keys(elementColors).length > 0) {
        colorData.push({
          selector,
          tag,
          id: el.id || '',
          classes: el.className || '',
          colors: elementColors
        });
      }
    });
    
    return colorData;
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
      const absoluteUrl = new URL(link, url).href;
      const res = await axios.get(absoluteUrl, { timeout: 5000 });
      cssTexts.push(res.data);
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
    elementColors,
    cssColors: Array.from(cssColors),
  };
}

// API endpoint to extract colors
app.post('/api/extract-colors', async (req, res) => {
  const { url } = req.body;
  
  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  try {
    console.log(`Extracting colors from: ${url}`);
    const result = await crawlColorsAndCSS(url);
    res.json(result);
  } catch (error) {
    console.error('Error extracting colors:', error);
    res.status(500).json({ error: 'Failed to extract colors from the URL' });
  }
});

// Serve the frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});