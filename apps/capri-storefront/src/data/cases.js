// Eyeglass cases / estuches — full Case category from caprioptics.com (auto-generated).
const RAW = [{"sku": "ANGLEFIT", "name": "ANGLEFIT", "colors": [{"name": "Transparent", "image": "https://caprioptics.com/wp-content/uploads/angelfit-scaled.jpg"}]}, {"sku": "CAPRIOCASE", "name": "CAPRIO CASE", "colors": [{"name": "Multi", "image": "https://caprioptics.com/wp-content/uploads/NEW-DC-scaled.jpg"}]}, {"sku": "CASEC-1", "name": "CASE C-1", "colors": [{"name": "Multi", "image": "https://caprioptics.com/wp-content/uploads/c1.jpg"}]}, {"sku": "CASEC-2", "name": "CASE C-2", "colors": [{"name": "Multi", "image": "https://caprioptics.com/wp-content/uploads/c2-scaled.jpg"}]}, {"sku": "CASEC-3", "name": "CASE C-3", "colors": [{"name": "Multi", "image": "https://caprioptics.com/wp-content/uploads/c-3-scaled.jpg"}]}, {"sku": "CASEC-6", "name": "CASE C-6", "colors": [{"name": "Multi", "image": "https://caprioptics.com/wp-content/uploads/c-6-scaled.jpg"}]}, {"sku": "CASEC-8", "name": "CASE C-8", "colors": [{"name": "Multi", "image": "https://caprioptics.com/wp-content/uploads/c-8-scaled.jpg"}]}, {"sku": "CASEC-11", "name": "CASE C-11", "colors": [{"name": "Multi", "image": "https://caprioptics.com/wp-content/uploads/c-11-scaled.jpg"}]}, {"sku": "CASEC-15", "name": "CASE C-15", "colors": [{"name": "Multi", "image": "https://caprioptics.com/wp-content/uploads/C-15-scaled.jpg"}]}, {"sku": "CASEC-20", "name": "CASE C-20", "colors": [{"name": "Black", "image": "https://caprioptics.com/wp-content/uploads/C20.jpg"}]}, {"sku": "CASEC-24", "name": "CASE C-24", "colors": [{"name": "Multi", "image": "https://caprioptics.com/wp-content/uploads/c24.jpg"}]}, {"sku": "CASEC-25", "name": "CASE C-25", "colors": [{"name": "Multi", "image": "https://caprioptics.com/wp-content/uploads/c25.jpg"}]}, {"sku": "CASEC-26", "name": "CASE C-26", "colors": [{"name": "Multi", "image": "https://caprioptics.com/wp-content/uploads/c26.jpg"}]}, {"sku": "CASEKC-3", "name": "CASE KC-3", "colors": [{"name": "Multi", "image": "https://caprioptics.com/wp-content/uploads/kc-3%20multi.jpg"}]}, {"sku": "CASESC-1", "name": "CASE SC-1", "colors": [{"name": "Multi", "image": "https://caprioptics.com/wp-content/uploads/sc-1-scaled.jpg"}]}, {"sku": "CASESC-2W/CLIP", "name": "CASE SC-2 W/CLIP", "colors": [{"name": "Multi", "image": "https://caprioptics.com/wp-content/uploads/sc-2-scaled.jpg"}]}, {"sku": "CASESC-4", "name": "CASE SC-4", "colors": [{"name": "Multi", "image": "https://caprioptics.com/wp-content/uploads/sc-4-scaled.jpg"}]}, {"sku": "CASESC-5", "name": "CASE SC-5", "colors": [{"name": "Multi", "image": "https://caprioptics.com/wp-content/uploads/sc-5.JPG"}]}, {"sku": "CASESC-6", "name": "CASE SC-6", "colors": [{"name": "Black", "image": "https://caprioptics.com/wp-content/uploads/sc-6-scaled.jpg"}]}, {"sku": "CASESE-2(20)", "name": "CASE SE-2 (20)", "colors": [{"name": "Multi", "image": "https://caprioptics.com/wp-content/uploads/SE-2-scaled.jpg"}]}, {"sku": "CASESE-3", "name": "CASE SE-3", "colors": [{"name": "Multi", "image": "https://caprioptics.com/wp-content/uploads/SE3.jpg"}]}, {"sku": "CASESE-4", "name": "CASE SE-4", "colors": [{"name": "Multi", "image": "https://caprioptics.com/wp-content/uploads/SE-4-scaled.jpg"}]}, {"sku": "DICAPRIOCASE", "name": "DI CAPRIO CASE", "colors": [{"name": "Multi", "image": "https://caprioptics.com/wp-content/uploads/DC%20CASE-scaled.jpg"}]}, {"sku": "GRANDECASE", "name": "GRANDE CASE", "colors": [{"name": "Multi", "image": "https://caprioptics.com/wp-content/uploads/GRANDE%20CASE-scaled.jpg"}]}, {"sku": "SIMPLYLITECASE", "name": "SIMPLYLITE CASE", "colors": [{"name": "Multi", "image": "https://caprioptics.com/wp-content/uploads/SL%20Case-scaled.jpg"}]}, {"sku": "SPECIALC1", "name": "SPECIAL C1", "colors": [{"name": "Multi", "image": "https://caprioptics.com/wp-content/uploads/c1.jpg"}]}, {"sku": "SPECIALC15", "name": "SPECIAL C15", "colors": [{"name": "Multi", "image": "https://caprioptics.com/wp-content/uploads/C-15-scaled.jpg"}]}, {"sku": "SPECIALC2", "name": "SPECIAL C2", "colors": [{"name": "Multi", "image": "https://caprioptics.com/wp-content/uploads/c2-scaled.jpg"}]}];

function hash(str){let h=0;for(let i=0;i<str.length;i++)h=(h*31+str.charCodeAt(i))&0xffffffff;return Math.abs(h);}
const priceFor=(sku)=>Math.round((5.95+(hash(sku)%8))*100)/100;
const ratingFor=(sku)=>Math.round((4.4+(hash(sku+"r")%6)/10)*10)/10;
const reviewsFor=(sku)=>12+(hash(sku+"rv")%180);
const CHEX={multi:"#9aa3b0",black:"#1a1a1a",transparent:"#dfe6ee",transparente:"#dfe6ee",clear:"#dfe6ee",brown:"#6b4423",blue:"#2f5fa8",gold:"#c9a44a",silver:"#c0c0c0",grey:"#8a8a8a",gunmetal:"#4b4f56"};
const chex=(n)=>{const k=String(n).toLowerCase();if(CHEX[k])return CHEX[k];for(const t of k.split(/[^a-z]+/))if(CHEX[t])return CHEX[t];return "#9aa3b0";};

// Enrich raw case records (sku,name,colors[,material]) — used for the static seed AND
// the daily live catalog (cases.json).
export function enrichCases(list){
  return (list || []).filter((c)=>c && c.colors && c.colors.length).map((c)=>({
    ...c,
    slug: "case-"+String(c.sku).toLowerCase().replace(/[^a-z0-9]+/g,"-"),
    brand: "Cases",
    brand_slug: "case",
    isCase: true,
    material: c.material || "",
    price: priceFor(c.sku),
    rating: ratingFor(c.sku),
    reviews: reviewsFor(c.sku),
    colors: c.colors.map((x)=>({...x, hex: x.hex || chex(x.name)})),
  }));
}

export const SEED_CASES = RAW;
export const CASES = enrichCases(RAW);
export const CASE_BY_SLUG = Object.fromEntries(CASES.map((c)=>[c.slug, c]));

// Seed-only recommender; the live app uses catalogStore.recommendedCases.
export function recommendedCases(seed, n=3, pool=CASES){
  if(!pool.length) return [];
  const start=hash(seed||"x")%pool.length;
  const out=[];
  for(let i=0;i<n;i++)out.push(pool[(start+i)%pool.length]);
  return out;
}
