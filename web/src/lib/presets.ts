import type { BBox } from './data'

export type Preset = { id: string; name: string; where: string; note: string; bbox: BBox }

export const PRESETS: Preset[] = [
  { id: 'chiang-mai', name: 'Northern Thailand', where: 'Chiang Mai · Chiang Rai · Mae Hong Son', note: 'Late dry-season forest and field burning; the haze season', bbox: [97.5, 17.5, 101.5, 20.5] },
  { id: 'taiwan', name: 'Taiwan', where: 'Whole island', note: 'Rice-straw and sugarcane burning on the western plain', bbox: [120.0, 21.75, 122.25, 25.5] },
  { id: 'punjab', name: 'Punjab & Haryana', where: 'North-west India', note: 'Two harvests, two stubble-burning pulses a year', bbox: [73.5, 28.5, 77.5, 32.5] },
  { id: 'sumatra', name: 'Riau & Jambi', where: 'Sumatra, Indonesia', note: 'Peat fires that surge in El Niño years', bbox: [100.0, -3.0, 105.0, 2.5] },
  { id: 'amazon', name: 'Arc of deforestation', where: 'Mato Grosso · Pará, Brazil', note: 'Land-clearing fires along the Amazon’s southern edge', bbox: [-62.0, -14.0, -50.0, -6.0] },
  { id: 'miombo', name: 'Miombo woodlands', where: 'Angola · Zambia · DR Congo', note: 'Among the most frequently burned landscapes on Earth', bbox: [18.0, -16.0, 30.0, -8.0] },
  { id: 'california', name: 'Northern California', where: 'Sierra Nevada · Coast Ranges', note: 'Late-summer wildfire, with extreme years', bbox: [-124.5, 36.0, -118.0, 42.0] },
  { id: 'nsw', name: 'South-east Australia', where: 'New South Wales · Victoria', note: 'The 2019–20 Black Summer stands alone', bbox: [144.0, -39.0, 153.75, -28.5] },
  { id: 'portugal', name: 'Portugal', where: 'Iberian west', note: 'Short, violent summers — 2003, 2005, 2017', bbox: [-9.75, 36.75, -6.0, 42.25] },
  { id: 'yakutia', name: 'Yakutia', where: 'Eastern Siberia', note: 'Boreal fire, climbing since the late 2010s', bbox: [112.0, 58.0, 136.0, 68.0] },
  { id: 'canada', name: 'Boreal Canada', where: 'Alberta · Saskatchewan · NWT', note: 'Lightning fires; 2023 broke every record', bbox: [-124.0, 53.0, -102.0, 63.0] },
  { id: 'ukraine', name: 'Eastern Ukraine', where: 'Dnipro to Donbas', note: 'Field burning, then a front line', bbox: [32.0, 46.0, 40.25, 50.5] },
]
