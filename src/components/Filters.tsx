/**
 * Фильтры списков.
 *
 * Обычная HTML-форма с method="get": выбор аналитика оказывается
 * в адресной строке. Это даёт три вещи бесплатно — ссылку на отфильтрованный
 * список можно переслать коллеге, кнопка «назад» браузера работает как
 * ожидается, а состояние фильтра не теряется при обновлении страницы.
 *
 * Серверный компонент без состояния: значения приходят из searchParams
 * страницы, применение — обычная отправка формы. Клиентский код для
 * этого не нужен.
 */

import { type Label } from '../core/domain/enums';
import { type Locale, translator } from '../i18n/dict';

export interface SelectOption {
  value: string;
  label: Label;
}

export function FilterForm({
  locale,
  children,
  action,
}: {
  locale: Locale;
  children: React.ReactNode;
  action: string;
}) {
  const t = translator(locale);
  return (
    <form className="card no-print" method="get" action={action}>
      <div className="grid grid-3">{children}</div>
      <div className="row" style={{ marginTop: 12 }}>
        <button type="submit" className="btn-primary">
          {t('apply')}
        </button>
        <a className="btn" href={action}>
          {t('reset')}
        </a>
      </div>
    </form>
  );
}

export function TextFilter({
  name,
  label,
  placeholder,
  value,
}: {
  name: string;
  label: string;
  placeholder?: string;
  value?: string;
}) {
  return (
    <div className="field">
      <label htmlFor={`f-${name}`}>{label}</label>
      <input
        id={`f-${name}`}
        type="search"
        name={name}
        defaultValue={value ?? ''}
        placeholder={placeholder}
      />
    </div>
  );
}

export function SelectFilter({
  name,
  label,
  options,
  value,
  locale,
  anyLabel,
}: {
  name: string;
  label: string;
  options: readonly SelectOption[];
  value?: string;
  locale: Locale;
  anyLabel: string;
}) {
  return (
    <div className="field">
      <label htmlFor={`f-${name}`}>{label}</label>
      <select id={`f-${name}`} name={name} defaultValue={value ?? ''}>
        <option value="">{anyLabel}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label[locale]}
          </option>
        ))}
      </select>
    </div>
  );
}

export function CheckboxFilter({
  name,
  label,
  checked,
}: {
  name: string;
  label: string;
  checked?: boolean;
}) {
  return (
    <div className="field" style={{ alignSelf: 'end' }}>
      <label className="checkbox">
        <input type="checkbox" name={name} value="true" defaultChecked={checked} />
        {label}
      </label>
    </div>
  );
}

/** Приведение Record<T, Label> к списку вариантов для select. */
export function optionsFrom<T extends string>(
  values: readonly T[],
  labels: Record<T, Label>,
): SelectOption[] {
  return values.map((value) => ({ value, label: labels[value] }));
}
