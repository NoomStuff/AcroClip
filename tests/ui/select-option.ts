import type { Page } from "@playwright/test";

export async function selectOption(page: Page, label: string, value: string | number): Promise<void> {
   await page.getByRole("combobox", { name: label, exact: true }).click();
   const list = page.getByRole("listbox", { name: label, exact: true });
   const values = await list.getByRole("option").evaluateAll((options) => options.map((option) => option.getAttribute("data-value")));
   const index = values.indexOf(String(value));
   if (index < 0) throw new Error(`No ${label} option for ${value}`);
   await list.getByRole("option").nth(index).click();
}
