export function fn1(num: number, options?: { a?: number, b: string, c?: { d?: string, e?: string, f: string } }) {
    return num
}

type _Tfn1Params = Parameters<typeof fn1>;
type Params<T> = T extends (...args: any) => any ? Parameters<T> : never;
type _TParams = {
    fn1: Params<typeof fn1>
    }
;
