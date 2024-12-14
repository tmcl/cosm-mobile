declare module 'array-from-async' {
	interface ArrayAsync {
			/**
			 * Creates an array from an async iterator or iterable object.
			 * @param iterableOrArrayLike An async iterator or array-like object to convert to an array.
			 */
			<T>(iterableOrArrayLike: AsyncIterable<T> | Iterable<T | PromiseLike<T>> | ArrayLike<T | PromiseLike<T>>): Promise<T[]>;

			/**
			 * Creates an array from an async iterator or iterable object.
			 *
			 * @param iterableOrArrayLike An async iterator or array-like object to convert to an array.
			 * @param mapfn A mapping function to call on every element of itarableOrArrayLike.
			 *      Each return value is awaited before being added to result array.
			 * @param thisArg Value of 'this' used when executing mapfn.
			 */
			<T, U>(iterableOrArrayLike: AsyncIterable<T> | Iterable<T> | ArrayLike<T>, mapFn: (value: Awaited<T>) => U, thisArg?: any): Promise<Awaited<U>[]>;
	}

	declare const arrayAsync: ArrayAsync;
	export default arrayAsync;
}
