import { useEffect, useState } from "react";
import { Select, Input } from "../ui/ui.jsx";
import { listCategories } from "../../lib/repo.js";

const NEW_CATEGORY_VALUE = "__new__";

/**
 * A <select> of existing categories with a built-in "+ Add new category"
 * option. Choosing it swaps in a text input; typing a name there is what
 * actually creates the category — there's no separate category table,
 * a category exists the moment a product uses it.
 */
export default function CategorySelect({ value, onChange, loadCategories = listCategories }) {
  const [categories, setCategories] = useState([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    loadCategories().then(setCategories);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // If we're editing a product whose category isn't in the known list yet
  // (e.g. it was just typed and hasn't reloaded), still show it as an option.
  const options = value && !categories.includes(value) ? [value, ...categories] : categories;

  if (creating) {
    return (
      <Input
        autoFocus
        placeholder="New category name"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => {
          if (!value) setCreating(false);
        }}
      />
    );
  }

  return (
    <Select
      value={options.includes(value) ? value : ""}
      onChange={(e) => {
        if (e.target.value === NEW_CATEGORY_VALUE) {
          setCreating(true);
          onChange("");
        } else {
          onChange(e.target.value);
        }
      }}
    >
      <option value="">Uncategorized</option>
      {options.map((c) => (
        <option key={c} value={c}>{c}</option>
      ))}
      <option value={NEW_CATEGORY_VALUE}>+ Add new category…</option>
    </Select>
  );
}