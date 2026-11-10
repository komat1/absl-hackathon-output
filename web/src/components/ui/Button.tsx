import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "link" | "danger" | "danger-link";

/**
 * `danger` je VYPLNENÉ červené tlačidlo, nie podčiarknutý odkaz.
 *
 * Bolo to naopak — `danger` mapovalo na `.btn-danger`, čiže na červený TEXTOVÝ
 * odkaz — a vyplnené `.primary-button.danger` sa cez `Button` vôbec nedalo
 * vyrobiť. „Danger" tak znamenalo v paneli dve rôzne veci podľa toho, či sa
 * písala trieda alebo variant. Rozhodlo použitie: všetkých sedem volajúcich
 * (vrátenie predaja, zlikvidovanie nálezu, zlúčenie prevádzky, rozpustenie
 * reťazca, zrušenie výplaty, zamietnutie žiadosti) je POTVRDZOVACIE tlačidlo
 * deštruktívneho úkonu v pätičke — teda presne to vyplnené.
 *
 * Textový odkaz nezanikol, len sa volá `danger-link` (SyncPage, EventsPage
 * a spol. ho dovtedy mali len ako holú triedu).
 *
 * `--red` NIE JE `--brand`: značková je #c42329, deštruktívna #f87171 / #dc2626,
 * takže „Zamietnuť" a „Schváliť" vedľa seba ostávajú rozlíšiteľné.
 */
const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "primary-button",
  secondary: "secondary-button",
  link: "btn-link",
  danger: "primary-button danger",
  "danger-link": "btn-danger"
};

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
};

export function Button({ variant = "primary", className, type = "button", ...props }: ButtonProps) {
  const variantClass = VARIANT_CLASS[variant];
  return (
    <button
      type={type}
      className={[variantClass, className].filter(Boolean).join(" ")}
      {...props}
    />
  );
}
