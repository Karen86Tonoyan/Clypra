# Clypra Fonts Usage Reference

This document provides the absolute mapping and reference guide on how to render every supported Clypra font family in pure HTML/CSS or React components **without** utilizing the canvas rendering effects engine.

---

## 1. Mapped Font-Stack Values

When you retrieve a font name from a Clypra text preset or editor selection, you should map it to the corresponding CSS stack.

Here is the exact reference mapping table for all **27 supported font families**:

| Editor Value (Preset / Selection) | Raw HTML/CSS Declaration (`font-family`) | Category                   | Loading Source                             |
| :-------------------------------- | :--------------------------------------- | :------------------------- | :----------------------------------------- |
| **Inter Variable** / **Inter**    | `"Inter Variable", sans-serif`           | Google Web Font (Variable) | Local `@fontsource-variable`               |
| **Geist Variable** / **Geist**    | `"Geist Variable", sans-serif`           | Google Web Font (Variable) | Local `@fontsource-variable`               |
| **Outfit Variable** / **Outfit**  | `"Outfit Variable", sans-serif`          | Google Web Font (Variable) | Local `@fontsource-variable`               |
| **Space Grotesk Variable**        | `"Space Grotesk Variable", sans-serif`   | Google Web Font (Variable) | Local `@fontsource-variable`               |
| **Roboto Variable** / **Roboto**  | `"Roboto Variable", sans-serif`          | Google Web Font (Variable) | Local `@fontsource-variable`               |
| **Roboto Condensed**              | `"Roboto Condensed", sans-serif`         | Google Web Font (Variable) | Local `@fontsource-variable`               |
| **Open Sans**                     | `"Open Sans Variable", sans-serif`       | Google Web Font (Variable) | Local `@fontsource-variable`               |
| **Raleway**                       | `"Raleway Variable", sans-serif`         | Google Web Font (Variable) | Local `@fontsource-variable`               |
| **Oswald**                        | `"Oswald Variable", sans-serif`          | Google Web Font (Variable) | Local `@fontsource-variable`               |
| **Playfair Display**              | `"Playfair Display Variable", serif`     | Google Web Font (Variable) | Local `@fontsource-variable`               |
| **Nunito**                        | `"Nunito Variable", sans-serif`          | Google Web Font (Variable) | Local `@fontsource-variable`               |
| **Dancing Script**                | `"Dancing Script Variable", cursive`     | Google Web Font (Variable) | Local `@fontsource-variable`               |
| **Lato**                          | `"Lato", sans-serif`                     | Google Web Font (Static)   | Local `@fontsource` / Google Web Fonts CDN |
| **Anton**                         | `"Anton", sans-serif`                    | Google Web Font (Static)   | Local `@fontsource` / Google Web Fonts CDN |
| **Bebas Neue**                    | `"Bebas Neue", sans-serif`               | Google Web Font (Static)   | Local `@fontsource` / Google Web Fonts CDN |
| **Poppins**                       | `"Poppins", sans-serif`                  | Google Web Font (Static)   | Local `@fontsource` / Google Web Fonts CDN |
| **Permanent Marker**              | `"Permanent Marker", cursive`            | Google Web Font (Static)   | Local `@fontsource` / Google Web Fonts CDN |
| **Bangers**                       | `"Bangers", cursive`                     | Google Web Font (Static)   | Local `@fontsource` / Google Web Fonts CDN |
| **Press Start 2P**                | `"Press Start 2P", monospace`            | Google Web Font (Static)   | Local `@fontsource` / Google Web Fonts CDN |
| **Pacifico**                      | `"Pacifico", cursive`                    | Google Web Font (Static)   | Local `@fontsource` / Google Web Fonts CDN |
| **Arial**                         | `Arial, sans-serif`                      | System Font                | Native OS Fallback                         |
| **Arial Black**                   | `"Arial Black", sans-serif`              | System Font                | Native OS Fallback                         |
| **Arial Rounded MT Bold**         | `"Arial Rounded MT Bold", sans-serif`    | System Font                | Native OS Fallback                         |
| **Georgia**                       | `Georgia, serif`                         | System Font                | Native OS Fallback                         |
| **Times New Roman**               | `"Times New Roman", serif`               | System Font                | Native OS Fallback                         |
| **Courier New**                   | `"Courier New", monospace`               | System Font                | Native OS Fallback                         |
| **Impact**                        | `Impact, sans-serif`                     | System Font                | Native OS Fallback                         |
| **Verdana**                       | `Verdana, sans-serif`                    | System Font                | Native OS Fallback                         |
| **Trebuchet MS**                  | `"Trebuchet MS", sans-serif`             | System Font                | Native OS Fallback                         |
| **Palatino**                      | `Palatino, serif`                        | System Font                | Native OS Fallback                         |

---

## 2. Dynamic Integration Approach (Recommended)

To ensure robust loading, import and execute our centralized utility function `getFontFamilyStack` directly in your code.

### In React / TypeScript

Import `getFontFamilyStack` and apply it to inline style objects:

```typescript
import { getFontFamilyStack } from "@/features/text-effects/lib/helpers";

interface HeadlineProps {
  fontFamilyName: string; // e.g. "Montserrat" or "Arial"
  text: string;
}

export const Headline: React.FC<HeadlineProps> = ({ fontFamilyName, text }) => {
  const resolvedStack = getFontFamilyStack(fontFamilyName);

  return (
    <h1 style={{ fontFamily: resolvedStack }} className="text-4xl font-bold">
      {text}
    </h1>
  );
};
```

### In Pure HTML / CSS

In vanilla markup previews, declare the resolved font stack directly as an inline style value:

```html
<!-- Montserrat Example -->
<h1 style="font-family: 'Montserrat Variable', sans-serif;">Abdulkabir Musa</h1>

<!-- Press Start 2P Example -->
<h1 style="font-family: 'Press Start 2P', monospace;">Retro Arcade Text</h1>
```

---

## 3. How the CSS Loading Works Behind the Scenes

All `@fontsource` and `@fontsource-variable` packages are imported inside `src/index.css`. This ensures that they compile and cache within the Tauri desktop application, allowing the app to run completely **offline** without external CDN latency.

For secondary failover, a standard Google Web Fonts CDN link is appended to index.css:

```css
@import url("https://fonts.googleapis.com/css2?family=Roboto+Condensed:ital,wght@...&display=swap");
```

This dual loading preserves text rendering fidelity in the native Tauri desktop app.
