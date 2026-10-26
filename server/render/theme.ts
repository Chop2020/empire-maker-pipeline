// Interior themes. The Designer agent will pick/customize these later; Milestone 1 ships two.
import type { ProductType } from '../../shared/types.js';

export interface Theme {
  id: string;
  trim: { w: number; h: number }; // inches
  colors: {
    paper: string;
    ink: string;
    muted: string;
    accent: string; // headings kicker, rules
    accentInk: string; // accent text on paper (AA contrast)
    tint: string; // callout / panel background
    tintAlt: string;
    rule: string;
    coverBg: string;
    coverInk: string;
    coverAccent: string;
  };
  fonts: { display: string; body: string; ui: string };
}

const classic: Theme = {
  id: 'classic',
  trim: { w: 6, h: 9 },
  colors: {
    paper: '#FFFFFF',
    ink: '#1B1D22',
    muted: '#5D6169',
    accent: '#C9A54C',
    accentInk: '#7A5C16',
    tint: '#F6F2E7',
    tintAlt: '#F2F3F5',
    rule: '#E3DED1',
    coverBg: '#13203A',
    coverInk: '#FFFFFF',
    coverAccent: '#C9A54C',
  },
  fonts: { display: "'Source Serif 4', Georgia, serif", body: "'Source Serif 4', Georgia, serif", ui: "'Montserrat', 'Inter', sans-serif" },
};

const kitchen: Theme = {
  id: 'kitchen',
  trim: { w: 8, h: 10 },
  colors: {
    paper: '#FFFFFF',
    ink: '#1E1A17',
    muted: '#5F5650',
    accent: '#B4442B',
    accentInk: '#9A3520',
    tint: '#FAF3EC',
    tintAlt: '#F3EEE9',
    rule: '#E8DDD2',
    coverBg: '#1E1A17',
    coverInk: '#FFFFFF',
    coverAccent: '#E07A52',
  },
  fonts: { display: "'Source Serif 4', Georgia, serif", body: "'Inter', 'Helvetica Neue', sans-serif", ui: "'Montserrat', 'Inter', sans-serif" },
};

export function themeFor(type: ProductType): Theme {
  if (type === 'cookbook') return kitchen;
  return classic;
}
