export interface Mockup {
  id: string;
  name: string;
  file: string;
}

export const MOCKUPS: Mockup[] = [
  { id: 'white-tee', name: 'White T-Shirt', file: 'mockups/tshirt_white_heavyweight.png' },
  { id: 'black-tee', name: 'Black T-Shirt', file: 'mockups/tshirt_black.jpg' },
  { id: 'hoodie', name: 'Hoodie', file: 'mockups/hoodie_gray.jpg' },
  { id: 'forest-hoodie', name: 'Forest Hoodie', file: 'mockups/hoodie_forest_green.png' },
  { id: 'sweatshirt', name: 'Crewneck Sweatshirt', file: 'mockups/sweatshirt_oatmeal_crewneck.png' },
  { id: 'polo', name: 'Polo Shirt', file: 'mockups/polo_navy_front.png' },
  { id: 'denim', name: 'Denim Jacket', file: 'mockups/jacket_denim_back.png' },
  { id: 'bomber', name: 'Bomber Jacket', file: 'mockups/jacket_black_bomber_back.png' },
  { id: 'cap', name: 'Cap', file: 'mockups/cap_navy.jpg' },
  { id: 'beanie', name: 'Beanie', file: 'mockups/beanie_rust_cuffed.png' },
  { id: 'tote', name: 'Tote Bag', file: 'mockups/tote_natural_canvas.png' },
  { id: 'apron', name: 'Apron', file: 'mockups/apron_charcoal_canvas.png' }
];
