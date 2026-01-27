export function Promise_never<A>(): Promise<A> {
  return new Promise(() => {})
}
