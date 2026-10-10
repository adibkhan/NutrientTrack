/** A rough food family for the picture next to a food. Display only: never stored, never used for nutrition. */
export type FoodKind = 'fruit' | 'veg' | 'meat' | 'fish' | 'egg' | 'dairy' | 'grain' | 'drink' | 'sweet' | 'nut' | 'legume' | 'meal'

const CATEGORY_KINDS: Record<string, FoodKind> = {
  'Fruits and Fruit Juices': 'fruit',
  'Vegetables and Vegetable Products': 'veg',
  'Spices and Herbs': 'veg',
  'Beef Products': 'meat',
  'Pork Products': 'meat',
  'Lamb, Veal, and Game Products': 'meat',
  'Poultry Products': 'meat',
  'Sausages and Luncheon Meats': 'meat',
  'Finfish and Shellfish Products': 'fish',
  'Dairy and Egg Products': 'dairy',
  'Baked Products': 'grain',
  'Cereal Grains and Pasta': 'grain',
  'Breakfast Cereals': 'grain',
  'Beverages': 'drink',
  'Sweets': 'sweet',
  'Snacks': 'sweet',
  'Nut and Seed Products': 'nut',
  'Legumes and Legume Products': 'legume',
}

// Checked in order; the first family with a matching word wins: "chicken rice bowl" is meat, "egg noodles" is grain, "peanut butter" is nut.
const KEYWORDS: Array<[FoodKind, string[]]> = [
  ['drink', ['coffee', 'tea', 'latte', 'espresso', 'cappuccino', 'juice', 'smoothie', 'soda', 'cola', 'water', 'beer', 'wine', 'shake', 'kombucha', 'lemonade', 'drink']],
  ['sweet', ['cake', 'cookie', 'cookies', 'brownie', 'chocolate', 'candy', 'ice', 'donut', 'doughnut', 'pie', 'pudding', 'dessert', 'honey', 'syrup', 'sugar', 'jam', 'chips', 'popcorn', 'pretzels']],
  ['nut', ['peanut', 'peanuts', 'almond', 'almonds', 'cashew', 'cashews', 'walnut', 'walnuts', 'pistachio', 'pecan', 'nut', 'nuts', 'seed', 'seeds', 'tahini']],
  ['legume', ['bean', 'beans', 'lentil', 'lentils', 'chickpea', 'chickpeas', 'hummus', 'tofu', 'tempeh', 'edamame', 'dal', 'daal', 'soy']],
  ['fish', ['fish', 'salmon', 'tuna', 'cod', 'shrimp', 'prawn', 'prawns', 'sardine', 'sardines', 'tilapia', 'trout', 'crab', 'lobster', 'sushi', 'mackerel', 'halibut', 'scallops']],
  ['meat', ['chicken', 'beef', 'steak', 'pork', 'bacon', 'ham', 'turkey', 'lamb', 'sausage', 'burger', 'meatball', 'meatballs', 'jerky', 'brisket', 'kebab', 'pepperoni', 'salami', 'duck', 'veal', 'mutton', 'goat']],
  ['grain', ['noodle', 'noodles', 'pasta', 'spaghetti', 'bread', 'toast', 'bagel', 'rice', 'oat', 'oats', 'oatmeal', 'cereal', 'granola', 'tortilla', 'wrap', 'pita', 'naan', 'roti', 'chapati', 'croissant', 'muffin', 'pancake', 'pancakes', 'waffle', 'cracker', 'crackers', 'quinoa', 'couscous', 'bun', 'roll', 'biscuit']],
  ['egg', ['egg', 'eggs', 'omelet', 'omelette', 'frittata']],
  ['dairy', ['milk', 'yogurt', 'yoghurt', 'cheese', 'butter', 'cream', 'kefir', 'whey', 'cottage', 'paneer', 'ghee']],
  ['fruit', ['apple', 'apples', 'banana', 'bananas', 'berry', 'berries', 'strawberry', 'strawberries', 'blueberries', 'raspberries', 'grape', 'grapes', 'orange', 'oranges', 'mango', 'pear', 'peach', 'plum', 'kiwi', 'melon', 'watermelon', 'pineapple', 'cherry', 'cherries', 'dates', 'fig', 'figs', 'avocado', 'fruit', 'papaya', 'lemon', 'lime', 'raisins', 'apricot']],
  ['veg', ['salad', 'lettuce', 'spinach', 'kale', 'broccoli', 'carrot', 'carrots', 'tomato', 'tomatoes', 'cucumber', 'pepper', 'peppers', 'onion', 'onions', 'potato', 'potatoes', 'corn', 'peas', 'zucchini', 'cabbage', 'cauliflower', 'mushroom', 'mushrooms', 'celery', 'asparagus', 'eggplant', 'squash', 'pumpkin', 'beet', 'beets', 'greens', 'vegetable', 'vegetables', 'veggies', 'garlic']],
]

/** Family from a catalog category when there is one, otherwise from words in the name; "meal" when nothing fits. */
export const foodKind = (name: string, category?: string): FoodKind => {
  const fromCategory = category ? CATEGORY_KINDS[category] : undefined
  const words = new Set(name.toLowerCase().split(/[^a-z]+/).filter(Boolean))
  if (fromCategory === 'dairy' && (words.has('egg') || words.has('eggs'))) return 'egg'
  if (fromCategory) return fromCategory
  for (const [kind, keys] of KEYWORDS) if (keys.some((key) => words.has(key))) return kind
  return 'meal'
}
