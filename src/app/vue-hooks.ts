import {
  Teleport,
  defineComponent,
  h,
  inject,
  nextTick,
  onBeforeUnmount,
  provide,
  ref,
  type InjectionKey,
  type VNode,
} from "vue";

type Cleanup = void | (() => void);
type EffectRecord = {
  deps?: unknown[];
  cleanup?: Cleanup;
};
type HookState = {
  values: unknown[];
  effects: EffectRecord[];
  index: number;
  effectIndex: number;
  bump: () => void;
};

let activeHookState: HookState | null = null;

function depsChanged(prev?: unknown[], next?: unknown[]) {
  if (!next) return true;
  if (!prev) return true;
  if (prev.length !== next.length) return true;
  return next.some((value, index) => !Object.is(value, prev[index]));
}

export function defineVueFunctionComponent<P extends Record<string, unknown>>(
  render: (props: P, context?: unknown) => VNode | VNode[] | null,
) {
  return defineComponent((props: P, context) => {
    const version = ref(0);
    const hookState: HookState = {
      values: [],
      effects: [],
      index: 0,
      effectIndex: 0,
      bump: () => {
        version.value += 1;
      },
    };

    onBeforeUnmount(() => {
      hookState.effects.forEach(effect => {
        if (typeof effect.cleanup === "function") effect.cleanup();
      });
    });

    return () => {
      version.value;
      hookState.index = 0;
      hookState.effectIndex = 0;
      activeHookState = hookState;
      try {
        const mergedProps = { ...(context.attrs as Record<string, unknown>), ...(props as Record<string, unknown>) } as P;
        return render(mergedProps, context);
      } finally {
        activeHookState = null;
      }
    };
  });
}

export function useState<T>(initial: T | (() => T)): [T, (value: T | ((previous: T) => T)) => void] {
  if (!activeHookState) throw new Error("useState must be called while rendering a Vue component");
  const state = activeHookState;
  const index = state.index++;
  if (!(index in state.values)) {
    state.values[index] = typeof initial === "function" ? (initial as () => T)() : initial;
  }
  const setValue = (value: T | ((previous: T) => T)) => {
    const previous = state.values[index] as T;
    state.values[index] = typeof value === "function" ? (value as (previous: T) => T)(previous) : value;
    state.bump();
  };
  return [state.values[index] as T, setValue];
}

export function useRef<T>(initial: T) {
  if (!activeHookState) throw new Error("useRef must be called while rendering a Vue component");
  const state = activeHookState;
  const index = state.index++;
  if (!(index in state.values)) state.values[index] = { current: initial };
  return state.values[index] as { current: T };
}

export function useEffect(effect: () => Cleanup, deps?: unknown[]) {
  if (!activeHookState) throw new Error("useEffect must be called while rendering a Vue component");
  const state = activeHookState;
  const index = state.effectIndex++;
  const previous = state.effects[index];
  if (!depsChanged(previous?.deps, deps)) return;

  nextTick(() => {
    if (typeof previous?.cleanup === "function") previous.cleanup();
    const cleanup = effect();
    state.effects[index] = { deps, cleanup };
  });
}

export function useCallback<T extends (...args: never[]) => unknown>(callback: T) {
  return callback;
}

export function createContext<T>(defaultValue: T) {
  const key = Symbol("vue-context") as InjectionKey<T>;
  const Provider = defineComponent({
    props: {
      value: {
        type: null,
        required: true,
      },
    },
    setup(props, { slots }) {
      provide(key, props.value as T);
      return () => slots.default?.();
    },
  });

  return { key, defaultValue, Provider };
}

export function useContext<T>(context: { key: InjectionKey<T>; defaultValue: T }) {
  return inject(context.key, context.defaultValue);
}

export function createPortal(node: VNode | VNode[] | null, target: Element | string) {
  const to = typeof target === "string" ? target : "body";
  return h(Teleport, { to }, Array.isArray(node) ? () => node : () => (node ? [node] : []));
}
