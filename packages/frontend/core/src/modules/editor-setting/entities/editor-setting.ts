import type { DeepPartial } from '@blocksuite/affine/global/utils';
import {
  createSignalFromObservable,
  type Signal,
} from '@blocksuite/affine/shared/utils';
import { Entity, LiveData } from '@toeverything/infra';
import { isObject, merge } from 'lodash-es';
import type { Observable } from 'rxjs';
import { map } from 'rxjs';
import type { z } from 'zod';

import type { EditorSettingProvider } from '../provider/editor-setting-provider';
import { EditorSettingSchema } from '../schema';

type SettingItem<T> = {
  readonly value: T;
  set: (value: T) => void;

  $: LiveData<T>;
};

/**
 * Parses a persisted setting value, backfilling missing fields from the
 * schema's defaults instead of discarding the whole entry when the schema
 * has gained a field since the value was persisted. Falls back to the
 * schema's full default only when the merged result still doesn't validate
 * (e.g. a genuinely corrupted or incompatible stored value).
 */
export function parseSettingWithFallback<Schema extends z.ZodTypeAny>(
  schema: Schema,
  raw: unknown
): z.infer<Schema> {
  const parsed = schema.safeParse(raw);
  if (parsed.success) {
    return parsed.data;
  }
  const backfilled = isObject(raw)
    ? schema.safeParse(merge(schema.parse(undefined), raw))
    : { success: false as const };
  return backfilled.success ? backfilled.data : schema.parse(undefined);
}

export class EditorSetting extends Entity {
  constructor(public readonly provider: EditorSettingProvider) {
    super();

    const { signal, cleanup } = createSignalFromObservable<
      Partial<EditorSettingSchema>
    >(this.settings$, {});
    this.settingSignal = signal;
    this.disposables.push(cleanup);

    Object.entries(EditorSettingSchema.shape).forEach(([flagKey, flag]) => {
      const livedata$ = this.settings$.selector(
        s => s[flagKey as keyof EditorSettingSchema]
      );
      const item = {
        ...flag,
        get value() {
          return livedata$.value;
        },
        set: (value: any) => {
          this.set(flagKey as keyof EditorSettingSchema, value);
        },
        $: livedata$,
      } as SettingItem<unknown>;
      Object.defineProperty(this, flagKey, {
        get: () => {
          return item;
        },
      });
    });
  }

  settings$ = LiveData.from<EditorSettingSchema>(this.watchAll(), null as any);

  settingSignal: Signal<Partial<EditorSettingSchema>>;

  get<K extends keyof EditorSettingSchema>(key: K) {
    return this.settings$.value[key];
  }

  set<K extends keyof EditorSettingSchema>(
    key: K,
    value: DeepPartial<EditorSettingSchema[K]>
  ) {
    const schema = EditorSettingSchema.shape[key];
    const curValue = this.get(key);
    const nextValue = isObject(curValue) ? merge(curValue, value) : value;
    this.provider.set(key, JSON.stringify(schema.parse(nextValue)));
  }

  private watchAll(): Observable<EditorSettingSchema> {
    return this.provider.watchAll().pipe(
      map(
        all =>
          Object.fromEntries(
            Object.entries(EditorSettingSchema.shape).map(([key, schema]) => {
              const value = all[key];
              const raw = value ? JSON.parse(value) : undefined;
              return [key, parseSettingWithFallback(schema, raw)];
            })
          ) as EditorSettingSchema
      )
    );
  }
}

export type EditorSettingExt = EditorSetting & {
  [K in keyof EditorSettingSchema]: SettingItem<EditorSettingSchema[K]>;
};
