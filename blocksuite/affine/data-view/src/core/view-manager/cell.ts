import { computed, type ReadonlySignal } from '@preact/signals-core';

import { fromJson } from '../property/utils.js';
import type { Property } from './property.js';
import type { Row } from './row.js';
import type { SingleView } from './single-view.js';

export interface Cell<
  RawValue = unknown,
  JsonValue = unknown,
  Data extends Record<string, unknown> = Record<string, unknown>,
> {
  readonly view: SingleView;
  readonly rowId: string;
  readonly row: Row;
  readonly propertyId: string;
  readonly property: Property<RawValue, JsonValue, Data>;

  readonly isEmpty$: ReadonlySignal<boolean>;
  readonly value$: ReadonlySignal<RawValue | undefined>;
  readonly jsonValue$: ReadonlySignal<JsonValue | undefined>;
  readonly stringValue$: ReadonlySignal<string | undefined>;

  valueSet(value: RawValue | undefined): void;
  jsonValueSet(value: JsonValue | undefined): void;
}

export class CellBase<
  RawValue = unknown,
  JsonValue = unknown,
  Data extends Record<string, unknown> = Record<string, unknown>,
> implements Cell<RawValue, JsonValue, Data> {
  get dataSource() {
    return this.view.manager.dataSource;
  }

  meta$ = computed(() => {
    return this.dataSource.propertyMetaGet(this.property.type$.value);
  });

  private _lastValue: unknown;

  /**
   * Values are read through the property's schema, which returns a new
   * array or object every time (a multi-select's ids, for example), and
   * any change in the database recomputes every cell. Keeping the previous
   * value when the new one has the same contents stops every select cell
   * in the table re-rendering on each key typed in another cell.
   */
  value$ = computed(() => {
    const value = this.view.manager.dataSource.cellValueGet(
      this.rowId,
      this.propertyId
    );
    if (isSameShallowValue(this._lastValue, value)) {
      return this._lastValue as RawValue;
    }
    this._lastValue = value;
    return value as RawValue;
  });

  isEmpty$: ReadonlySignal<boolean> = computed(() => {
    return (
      this.meta$.value?.config.jsonValue.isEmpty({
        value: this.jsonValue$.value,
        dataSource: this.view.manager.dataSource,
      }) ?? true
    );
  });

  jsonValue$: ReadonlySignal<JsonValue | undefined> = computed(() => {
    const toJson = this.property.meta$.value?.config.rawValue.toJson;
    if (!toJson) {
      return undefined;
    }
    return (
      (toJson({
        value: this.value$.value,
        data: this.property.data$.value,
        dataSource: this.dataSource,
      }) as JsonValue) ?? undefined
    );
  });

  property$ = computed(() => {
    return this.view.propertyGetOrCreate(this.propertyId) as Property<
      RawValue,
      JsonValue,
      Data
    >;
  });

  stringValue$: ReadonlySignal<string | undefined> = computed(() => {
    const toString = this.property.meta$.value?.config.rawValue.toString;
    if (!toString) {
      return;
    }
    return toString({
      value: this.value$.value,
      data: this.property.data$.value,
    });
  });

  get property(): Property<RawValue, JsonValue, Data> {
    return this.property$.value;
  }

  get row(): Row {
    return this.view.rowGetOrCreate(this.rowId);
  }

  constructor(
    public view: SingleView,
    public propertyId: string,
    public rowId: string
  ) {}

  valueSet(value: RawValue | undefined): void {
    this.view.manager.dataSource.cellValueChange(
      this.rowId,
      this.propertyId,
      value
    );
  }

  jsonValueSet(value: JsonValue | undefined): void {
    const meta = this.property.meta$.value;
    if (!meta) {
      return;
    }
    const rawValue = fromJson(meta.config, {
      value: value,
      data: this.property.data$.value,
      dataSource: this.view.manager.dataSource,
    });
    this.dataSource.cellValueChange(this.rowId, this.propertyId, rawValue);
  }
}

/** Same value, or arrays / plain objects whose items are the same. */
function isSameShallowValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => Object.is(item, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every(key => Object.is(a[key], b[key]))
    );
  }
  return false;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
