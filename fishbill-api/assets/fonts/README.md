# PDF Fonts

Place Unicode-capable TTF fonts here so invoice/delivery-note PDFs render Greek correctly.

## Recommended: Noto Sans (free, Google Fonts)

Download from https://fonts.google.com/noto/specimen/Noto+Sans :
- `NotoSans-Regular.ttf`
- `NotoSans-Bold.ttf`

## Alternative: DejaVu Sans (also free)

Download from https://dejavu-fonts.github.io :
- `DejaVuSans.ttf`
- `DejaVuSans-Bold.ttf`

## On Windows (XAMPP local dev)

No action needed — `pdf.service.js` auto-detects `C:\Windows\Fonts\arial.ttf` which supports Greek.

## On Linux (production)

Install DejaVu fonts:
```
sudo apt-get install fonts-dejavu-core
```
Or place the files here and set `PDF_FONT_PATH` in your `.env`.
