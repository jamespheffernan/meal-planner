-- Keep unquantified ingredients without fabricating an amount.
ALTER TABLE "recipe_ingredients" ALTER COLUMN "quantity" DROP NOT NULL;
