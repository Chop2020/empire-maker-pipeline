// Node 20 compatibility for pdf.js (which targets Node 22+). Import this before anything that loads pdfjs-dist.
// Replit images can ship Node 20 even when .replit asks for 22, so the app must run on both.

type Resolvers<T> = { promise: Promise<T>; resolve: (v: T | PromiseLike<T>) => void; reject: (e?: unknown) => void };

const P = Promise as unknown as { withResolvers?: <T>() => Resolvers<T> };
if (typeof P.withResolvers !== 'function') {
  P.withResolvers = function withResolvers<T>(): Resolvers<T> {
    let resolve!: Resolvers<T>['resolve'];
    let reject!: Resolvers<T>['reject'];
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

export {};
