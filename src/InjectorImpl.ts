/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-return */
import { Scope } from './api/Scope';
import { InjectionToken, INJECTOR_TOKEN, TARGET_TOKEN } from './api/InjectionToken';
import { InjectableClass, InjectableAsyncClass, InjectableFunction, Injectable } from './api/Injectable';
import { Injector } from './api/Injector';
import { InjectionError, InjectorDisposedError } from './errors';
import { Disposable } from './api/Disposable';
import { isDisposable } from './utils';
import { TChildContext } from './api/TChildContext';
import { InjectionTarget } from './api/InjectionTarget';

const DEFAULT_SCOPE = Scope.Singleton;

/*

# Composite design pattern:

         ┏━━━━━━━━━━━━━━━━━━┓
         ┃ AbstractInjector ┃
         ┗━━━━━━━━━━━━━━━━━━┛
                   ▲
                   ┃
          ┏━━━━━━━━┻━━━━━━━━┓
          ┃                 ┃
 ┏━━━━━━━━┻━━━━━┓   ┏━━━━━━━┻━━━━━━━┓
 ┃ RootInjector ┃   ┃ ChildInjector ┃
 ┗━━━━━━━━━━━━━━┛   ┗━━━━━━━━━━━━━━━┛
                            ▲
                            ┃
          ┏━━━━━━━━━━━━━━━━━┻━┳━━━━━━━━━━━━━━━━┓
 ┏━━━━━━━━┻━━━━━━━━┓ ┏━━━━━━━━┻━━━━━━┓ ┏━━━━━━━┻━━━━━━━┓
 ┃ FactoryInjector ┃ ┃ ClassInjector ┃ ┃ ValueInjector ┃
 ┗━━━━━━━━━━━━━━━━━┛ ┗━━━━━━━━━━━━━━━┛ ┗━━━━━━━━━━━━━━━┛
*/

abstract class AbstractInjector<TContext> implements Injector<TContext> {
  private childInjectors: Set<Injector<any>> = new Set();

  public async injectClass<R, Tokens extends InjectionToken<TContext>[]>(
    Class: InjectableClass<TContext, R, Tokens>,
    providedIn?: Function
  ): Promise<R> {
    this.throwIfDisposed(Class);
    try {
      const args: any[] = await this.resolveParametersToInject(Class, providedIn);
      return new Class(...(args as any));
    } catch (error) {
      throw InjectionError.create(Class, error as Error);
    }
  }

  public async injectAsyncClass<R, Tokens extends InjectionToken<TContext>[]>(
    loader: InjectableAsyncClass<TContext, R, Tokens>,
    providedIn?: Function
  ): Promise<R> {
    this.throwIfDisposed(loader);
    try {
      const Class = await loader();
      const args: any[] = await this.resolveParametersToInject(Class, providedIn);
      return new Class(...(args as any));
    } catch (error) {
      throw InjectionError.create(loader, error as Error);
    }
  }

  public async injectFunction<R, Tokens extends InjectionToken<TContext>[]>(
    fn: InjectableFunction<TContext, R, Tokens>,
    providedIn?: Function
  ): Promise<R> {
    this.throwIfDisposed(fn);
    try {
      const args: any[] = await this.resolveParametersToInject(fn, providedIn);
      return await fn(...(args as any));
    } catch (error) {
      throw InjectionError.create(fn, error as Error);
    }
  }

  private resolveParametersToInject<Tokens extends InjectionToken<TContext>[]>(
    injectable: Injectable<TContext, any, Tokens>,
    target?: Function
  ): Promise<any[]> {
    const tokens: InjectionToken<TContext>[] = (injectable as any).inject || [];
    return Promise.all(
      tokens.map(async (key) => {
        switch (key) {
          case TARGET_TOKEN:
            return target as any;
          case INJECTOR_TOKEN:
            return this as any;
          default:
            return await this.resolveInternal(key, injectable);
        }
      })
    );
  }

  public provideValue<Token extends string, R>(token: Token, value: R): AbstractInjector<TChildContext<TContext, R, Token>> {
    this.throwIfDisposed(token);
    const provider = new ValueProvider(this, token, value);
    this.childInjectors.add(provider as Injector<any>);
    return provider;
  }

  public provideClass<Token extends string, R, Tokens extends InjectionToken<TContext>[]>(
    token: Token,
    Class: InjectableClass<TContext, R, Tokens>,
    scope = DEFAULT_SCOPE
  ): AbstractInjector<TChildContext<TContext, R, Token>> {
    this.throwIfDisposed(token);
    const provider = new ClassProvider(this, token, scope, Class);
    this.childInjectors.add(provider as Injector<any>);
    return provider;
  }

  public provideAsyncClass<Token extends string, R, Tokens extends InjectionToken<TContext>[]>(
    token: Token,
    laoder: InjectableAsyncClass<TContext, R, Tokens>,
    scope = DEFAULT_SCOPE
  ): AbstractInjector<TChildContext<TContext, R, Token>> {
    this.throwIfDisposed(token);
    const provider = new AsyncClassProvider(this, token, scope, laoder);
    this.childInjectors.add(provider as Injector<any>);
    return provider;
  }

  public provideFactory<Token extends string, R, Tokens extends InjectionToken<TContext>[]>(
    token: Token,
    factory: InjectableFunction<TContext, R, Tokens>,
    scope = DEFAULT_SCOPE
  ): AbstractInjector<TChildContext<TContext, R, Token>> {
    this.throwIfDisposed(token);
    const provider = new FactoryProvider(this, token, scope, factory);
    this.childInjectors.add(provider as Injector<any>);
    return provider;
  }

  public async resolve<Token extends keyof TContext>(token: Token, target?: Function): Promise<TContext[Token]> {
    this.throwIfDisposed(token);
    return await this.resolveInternal(token, target);
  }

  protected throwIfDisposed(injectableOrToken: InjectionTarget) {
    if (this.isDisposed) {
      throw new InjectorDisposedError(injectableOrToken);
    }
  }

  public removeChild(child: Injector<any>): void {
    this.childInjectors.delete(child);
  }

  private isDisposed = false;

  public async dispose() {
    if (!this.isDisposed) {
      this.isDisposed = true; // be sure new disposables aren't added while we're disposing
      const promises = [];
      for (const child of this.childInjectors) {
        promises.push(child.dispose());
      }
      await Promise.all(promises);
      await this.disposeInjectedValues();
    }
  }

  protected abstract disposeInjectedValues(): Promise<void>;

  protected abstract resolveInternal<Token extends keyof TContext>(token: Token, target?: Function): PromiseLike<TContext[Token]>;
}

class RootInjector extends AbstractInjector<{}> {
  public override resolveInternal(token: never): never {
    throw new Error(`No provider found for "${token}"!.`);
  }
  protected override disposeInjectedValues() {
    return Promise.resolve();
  }
}

abstract class ChildInjector<TParentContext, TProvided, CurrentToken extends string> extends AbstractInjector<
  TChildContext<TParentContext, TProvided, CurrentToken>
> {
  private cached: { value?: any } | undefined;
  private readonly disposables = new Set<Disposable>();

  constructor(protected readonly parent: AbstractInjector<TParentContext>, protected readonly token: CurrentToken, private readonly scope: Scope) {
    super();
  }

  protected abstract result(target: Function | undefined): TProvided | PromiseLike<TProvided>;

  public override async dispose() {
    this.parent.removeChild(this as Injector<any>);
    await super.dispose();
  }

  protected override async disposeInjectedValues() {
    const promisesToAwait = [...this.disposables.values()].map((disposable) => disposable.dispose());
    await Promise.all(promisesToAwait);
  }

  protected override async resolveInternal<SearchToken extends keyof TChildContext<TParentContext, TProvided, CurrentToken>>(
    token: SearchToken,
    target: Function | undefined
  ): Promise<TChildContext<TParentContext, TProvided, CurrentToken>[SearchToken]> {
    if (token === this.token) {
      if (this.cached) {
        return this.cached.value;
      } else {
        try {
          const value = await this.result(target);
          this.addToCacheIfNeeded(value);
          return value as any;
        } catch (error) {
          throw InjectionError.create(token, error as Error);
        }
      }
    } else {
      return (await this.parent.resolve(token as any, target)) as any;
    }
  }

  private addToCacheIfNeeded(value: TProvided) {
    if (this.scope === Scope.Singleton) {
      this.cached = { value };
    }
  }

  protected registerProvidedValue(value: TProvided): TProvided {
    if (isDisposable(value)) {
      this.disposables.add(value);
    }
    return value;
  }
}

class ValueProvider<TParentContext, TProvided, ProvidedToken extends string> extends ChildInjector<TParentContext, TProvided, ProvidedToken> {
  constructor(parent: AbstractInjector<TParentContext>, token: ProvidedToken, private readonly value: TProvided) {
    super(parent, token, Scope.Transient);
  }
  protected override result(): TProvided {
    return this.value;
  }
}

class FactoryProvider<TParentContext, TProvided, ProvidedToken extends string, Tokens extends InjectionToken<TParentContext>[]> extends ChildInjector<
  TParentContext,
  TProvided,
  ProvidedToken
> {
  constructor(
    parent: AbstractInjector<TParentContext>,
    token: ProvidedToken,
    scope: Scope,
    private readonly injectable: InjectableFunction<TParentContext, TProvided, Tokens>
  ) {
    super(parent, token, scope);
  }
  protected override async result(target: Function): Promise<TProvided> {
    return this.registerProvidedValue(await this.parent.injectFunction(this.injectable, target));
  }
}

class ClassProvider<TParentContext, TProvided, ProvidedToken extends string, Tokens extends InjectionToken<TParentContext>[]> extends ChildInjector<
  TParentContext,
  TProvided,
  ProvidedToken
> {
  constructor(
    parent: AbstractInjector<TParentContext>,
    token: ProvidedToken,
    scope: Scope,
    private readonly injectable: InjectableClass<TParentContext, TProvided, Tokens>
  ) {
    super(parent, token, scope);
  }
  protected override async result(target: Function): Promise<TProvided> {
    return this.registerProvidedValue(await this.parent.injectClass(this.injectable, target));
  }
}

class AsyncClassProvider<
  TParentContext,
  TProvided,
  ProvidedToken extends string,
  Tokens extends InjectionToken<TParentContext>[]
> extends ChildInjector<TParentContext, TProvided, ProvidedToken> {
  constructor(
    parent: AbstractInjector<TParentContext>,
    token: ProvidedToken,
    scope: Scope,
    private readonly injectable: InjectableAsyncClass<TParentContext, TProvided, Tokens>
  ) {
    super(parent, token, scope);
  }
  protected override async result(target: Function): Promise<TProvided> {
    return this.registerProvidedValue(await this.parent.injectAsyncClass(this.injectable, target));
  }
}

export function createInjector(): Injector<{}> {
  /* eslint-disable */
  /* @ts-ignore */
  return new RootInjector();
}
