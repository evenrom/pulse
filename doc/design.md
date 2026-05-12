# Design System: Sapphire Glassmorphism (Pulse Edition)

## 1. Visual Identity
**Style Name**: Sapphire Glassmorphism.
**Tone**: Institutional, Authoritative, Ethereal.

## 2. Color Palette
- **Deep Space**: `#070D1F` (Main Background)
- **Sapphire Glass**: `#0C1326` (Card Surfaces)
- **Electric Blue**: `#8EABFF` (Primary Action / Pulse)
- **Emerald Profit**: `#10B981` (Positive deltas)
- **Crimson Loss**: `#B91C1C` (Negative deltas)

## 3. Typography
- **UI Elements**: *Hanken Grotesk* (Clean, geometric).
- **Financial Data**: *JetBrains Mono* (Tabular tracking for perfect alignment).
- **Display**: 48pt Bold (Net Worth).
- **Data-Lg**: 18pt Medium (Table values).

## 4. Component Specification
### 4.1 Glass Cards
- **Backdrop Blur**: 24px.
- **Border**: 1px solid `rgba(141, 169, 255, 0.1)`.
- **Inner Shadow**: 1px inset white (12% opacity) for edge definition.
- **Outer Shadow**: `0 8px 32px rgba(0, 0, 0, 0.4)`.

### 4.2 Hero Performance Graph
- **Type**: Smooth Line Chart (Chart.js).
- **Fill**: Linear Gradient (Electric Blue -> Transparent).
- **Logic**: Baseline is 0% (Net Invested).

### 4.3 Navigation
- **Structure**: Fixed Bottom Nav with 4 Tabs.
- **Active State**: Icon glow effect with an Electric Blue dot indicator.

### 4.4 Currency Toggle
- Minimalist pill-shaped toggle next to the Net Worth balance.
- Smooth 150ms transition between USD and ILS symbols.
