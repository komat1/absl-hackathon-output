import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { findIconDefinition, type IconName, type IconProp, type IconPrefix } from "@fortawesome/fontawesome-svg-core";
import { faCircleQuestion } from "../../lib/icons";
import type { ComponentProps } from "react";

type IconProps = Omit<ComponentProps<typeof FontAwesomeIcon>, "icon"> & {
  icon: IconProp | string;
};

export function Icon({ icon, className, ...props }: IconProps) {
  // `fa-spin` inside the icon string is a FontAwesome CSS class, and this project
  // ships FA as SVG components with no FA stylesheet — so the class had nowhere
  // to land and the spinner rendered frozen. Translate it to the Tailwind
  // animation the rest of the panel already uses (`animate-spin`).
  const spin = typeof icon === "string" && /(^|\s)fa-spin(\s|$)/.test(icon);
  const cls = [spin ? "animate-spin" : "", className ?? ""].filter(Boolean).join(" ");
  return <FontAwesomeIcon icon={resolveIcon(icon)} {...(cls ? { className: cls } : {})} {...props} />;
}

function resolveIcon(icon: IconProp | string): IconProp {
  if (typeof icon !== "string") {
    return icon;
  }

  // Family/style modifier classes are not the icon name. This project ships
  // sharp-regular (`fasr`) and kit (`fak`) glyphs, plus a handful of hand-copied
  // sharp-solid (`fass`, lib/sharpSolidIcons.ts) — so `fa-solid` picks the filled
  // glyph when one exists and every other style hint is normalised to regular.
  const MODIFIERS = ["fa-sharp", "fa-solid", "fa-regular", "fa-light", "fa-thin", "fa-duotone", "fa-brands", "fa-kit", "fa-spin", "fa-pulse", "fa-fw", "fa-beat", "fa-fade", "fa-flip"];
  const classes = icon.split(/\s+/).filter(Boolean);
  const iconClass = classes.find((item) => item.startsWith("fa-") && !MODIFIERS.includes(item));
  if (!iconClass) {
    return faCircleQuestion;
  }

  const kit = classes.includes("fa-kit");
  const iconName = iconClass.replace(/^fa-/, "") as IconName;
  if (!kit && classes.includes("fa-solid")) {
    const filled = findIconDefinition({ prefix: "fass" as IconPrefix, iconName });
    if (filled) return filled;
  }
  const prefix: IconPrefix = kit ? ("fak" as IconPrefix) : ("fasr" as IconPrefix);
  return findIconDefinition({ prefix, iconName }) ?? faCircleQuestion;
}

/** Plná verzia reťazca ikony (pre vybratý stav). Kde plná ikona nie je, Icon nakreslí obrysovú. */
export function solidIcon(icon: string): string {
  return icon.replace(/(^|\s)fa-regular(?=\s|$)/, "$1fa-solid");
}
