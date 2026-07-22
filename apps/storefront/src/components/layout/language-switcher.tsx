"use client";

import { useTransition } from "react";
import { Globe } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { usePathname, useRouter } from "@/i18n/navigation";
import { routing, type Locale } from "@/i18n/routing";

export function LanguageSwitcher() {
  const t = useTranslations("languageSwitcher");
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleSelect = (nextLocale: Locale) => {
    startTransition(() => {
      router.replace(pathname, { locale: nextLocale });
    });
  };

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={t("label")}
          disabled={isPending}
          className="flex items-center gap-1.5 rounded-full p-2 text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors disabled:opacity-50"
        >
          <Globe className="h-5 w-5" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className="z-50 min-w-[10rem] rounded-xl border border-gray-100 bg-white p-1.5 shadow-lg"
        >
          {routing.locales.map((loc) => (
            <DropdownMenu.Item
              key={loc}
              onSelect={() => handleSelect(loc)}
              className={`flex cursor-pointer items-center rounded-lg px-3 py-2 text-sm outline-none transition-colors hover:bg-gray-50 ${
                loc === locale ? "font-semibold text-accent" : "text-gray-700"
              }`}
            >
              {t(loc)}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
