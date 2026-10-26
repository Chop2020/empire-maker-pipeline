// Empire Maker Publishing — locked publisher brand. Every book renders these identically.
import type { PublisherBrand } from '../shared/types.js';

export const EMPIRE_MAKER: { id: string; brand: PublisherBrand } = {
  id: 'pub_empire_maker',
  brand: {
    name: 'Empire Maker Publishing',
    tagline: 'Knowledge that builds empires',
    website: 'EmpireMakerPublishing.com',
    colors: {
      black: '#0B0B0C',
      gold: '#C9A54C',
      white: '#FFFFFF',
      muted: '#A8A39A',
      rule: 'rgba(255,255,255,0.14)',
    },
    font: 'Montserrat',
  },
};

export const websiteUrl = (b: PublisherBrand) => `https://${b.website.toLowerCase()}`;
