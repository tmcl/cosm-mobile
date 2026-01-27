export type KnownError =
  | {
      error:
        | "surfeit of nodes"
        | "insufficiency of nodes"
        | "empty string"
        | `unexpected node type ${number}`
        | `root element had name ${string} but we were asked to parse a root of ${string}`;
    }
  | {
      error: `while parsing array received the following errors:`;
      argument: { array_index: number; error: KnownError }[];
    }
  | {
      error: `while parsing object received the following errors:`;
      argument: { object_key: string | number | symbol; error: KnownError }[];
    }
  | {
      error: `value error`;
      message: string;
    };

export type Result<T> = { success: T } | KnownError;
export const mapResult = <T, R>(
  result: Result<T>,
  f: (t: T) => R
): Result<R> => {
  if ("success" in result) {
    return { success: f(result.success) };
  } else {
    return result;
  }
};

export const composeFoldMap = <A extends unknown[], T, R>(
  f: (...a: A) => Result<T>,
  g: (t: T) => Result<R>
): ((...a: A) => Result<R>) => {
  return (...args) => foldMap(f(...args), g);
};

export const foldMap = <T, R>(
  result: Result<T>,
  f: (t: T) => Result<R>
): Result<R> => {
  if ("success" in result) {
    return f(result.success);
  } else {
    return result;
  }
};

export type Parser<T> = (nodes: Node[]) => Result<T>;
export type Builder<T> = (
  document: Document,
  t: T
) => { attributes?: Attr[]; children: Node[] }[];
export type Builder0<T> = (document: Document, t: T) => [{ children: [] }];
export type Builder1<T> = (document: Document, t: T) => [{ children: [Node] }];
export type Builder01<T> = Builder0<T> | Builder1<T>;
export type ParserObject<T> = {
  [K in keyof T]: ParserSpec<T[K]>;
};

export type ParserSpec<K> = {
  type: "element" | "attribute";
  xmlname?: string;
  parser: Parser<K>;
} & AbsenceHandling<K>;
export type AbsenceHandling<K> =
  | {
      if_absent?: "continue anyway" | "optional key";
    }
  | {
      if_absent?: "default value";
      default: K;
    };

// An inline parser spec is not associated with an object: therefore, xmlname must be specified (it can't be
// guessed from an object key if the object key does not exist) and absence handling must not be optional key
// (since no object is constructed)
export type InlineParserSpec<K> = ParserSpec<K> & { xmlname: string } & {
  if_absent?: "continue anyway" | "default value";
};

export const parseInline =
  <T>(parserSpec: InlineParserSpec<T>): Parser<T> =>
  (nodes: Node[]): Result<T> => {
    console.log("from parse permission list", nodes);
    const key = parserSpec.xmlname;
    const val = parseObject({ [key]: parserSpec });
    return mapResult(val(nodes), (t) => t[key]);
  };

export type BuilderObject<T> = {
  [K in keyof T]:
    | { type: "element"; xmlname?: string; builder: Builder<T[K]> }
    | {
        type: "attribute";
        xmlname?: string;
        builder: Builder01<T[K]>;
      };
};
export type PicklerObject<T> = ParserObject<T> & BuilderObject<T>;

export const buildKvp =
  <K extends string, T extends string>(
    tagName: string,
    kAttr: string,
    vAttr: string
  ): Builder<Record<K, T>> =>
  (
    document: Document,
    val: Record<K, T>
  ): { attributes?: Attr[]; children: Node[] }[] =>
    [
      {
        children: Object.entries(val).map(([key, value]) => {
          const ele = document.createElement(tagName);
          ele.setAttribute(kAttr, key);
          ele.setAttribute(vAttr, String(value));
          return ele;
        }),
      },
    ];

const buildString: Builder1<string> = (document: Document, val: string) => {
  return [{ children: [document.createTextNode(val)] }];
};
export const parseString = (nodes: Node[]): Result<string> => {
  return withOneNode<string>(nodes, (node) => {
    switch (node.nodeType) {
      case node.ELEMENT_NODE:
        return parseString(Array.from(node.childNodes)); // we hereby verify that there is only one child node
      case node.ATTRIBUTE_NODE:
      case node.TEXT_NODE:
        return typeof node.textContent === "string"
          ? { success: node.textContent }
          : { error: "empty string" as const };
      default:
        return { error: `unexpected node type ${node.nodeType}` as const };
    }
  });
};
export const pickleStringBuilder = buildString;
export const pickleStringParser = parseString;
export const buildNumber: Builder1<number> = (
  document: Document,
  val: number
) => {
  return buildString(document, val.toString());
};
export const parseNumber = (node: Node[]): Result<number> => {
  return mapResult(parseString(node), (f) => +f);
};
export const pickleNumberBuilder = buildNumber;
export const pickleNumberParser = parseNumber;

// i can't seem to get access to jsdom's classes without a document,
// and the types aren't defined in such a way that this happens automatically
const isElementNode = (n: Node): n is Element => n.nodeType === n.ELEMENT_NODE;

export const buildArray =
  <T>(builder: Builder<T>): Builder<T[]> =>
  (document: Document, vals: T[]) => {
    return vals.flatMap((val) => builder(document, val));
  };

export const parseArray =
  <T>(parser: Parser<T>) =>
  (nodes: Node[]): Result<T[]> => {
    const results = nodes.map((node) => parser([node]));
    const errors: { array_index: number; error: KnownError }[] = [];
    const successes: T[] = [];
    results.map((result, i) => {
      if ("error" in result) {
        errors.push({ array_index: i, error: result });
      } else {
        successes.push(result.success);
      }
    });
    if (errors.length) {
      return {
        error: `while parsing array received the following errors:`,
        argument: errors,
      };
    } else {
      return { success: successes };
    }
  };

export const buildObject =
  <T>(builderObject: BuilderObject<T>): Builder<T> =>
  (
    document: Document,
    val: T
  ): [
    {
      attributes: Attr[];
      children: Node[];
    }
  ] => {
    const children: Node[] = [];
    const attributes: Attr[] = [];
    for (const key in builderObject) {
      const builder = builderObject[key];
      switch (builder.type) {
        case "element": {
          const childs = builder.builder(document, val[key]);
          childs.forEach((child) => {
            const node = document.createElement(builder.xmlname || key);
            child.attributes &&
              Array.from(child.attributes).forEach((a) =>
                node.setAttributeNode(a)
              );
            Array.from(node.childNodes).forEach((child) =>
              node.removeChild(child)
            ); //this had been node.removeChild(node), which seemed obviously wrong
            child.children.forEach((ch) => node.appendChild(ch));
            children.push(node);
          });
          break;
        }
        case "attribute": {
          const node = document.createAttribute(builder.xmlname || key);
          const [{ children }] = builder.builder(document, val[key]);
          const [childs] = children;
          node.textContent = childs ? childs.textContent : "";
          attributes.push(node);
          break;
        }
        default:
          unused(builder);
          break;
      }
    }
    return [{ children, attributes }];
  };

const handleAbsence = <T>(
  parser: ParserSpec<T>,
  nodes: Node[]
): Result<T> | null => {
  if (nodes.length === 0) {
    if ("default" in parser) {
      return { success: parser.default };
    } else if (parser.if_absent === "optional key") {
      return null;
    } else {
      const p: undefined | "continue anyway" = parser.if_absent;
      return parser.parser(nodes);
    }
  } else {
    return parser.parser(nodes);
  }
};

export const parseObject =
  <T extends object>(parserObject: ParserObject<T>) =>
  (nodes: Node[]): Result<T> => {
    return withOneNode<T>(nodes, (node) => {
      const errors: { object_key: keyof T; error: KnownError }[] = [];
      const output: Partial<T> = {};
      for (const key in parserObject) {
        const parser = parserObject[key];
        const parseValue = (): null | Result<T[Extract<keyof T, string>]> => {
          switch (parser.type) {
            case "element": {
              const foundNodes: Element[] = [];
              Array.from(node.childNodes || []).forEach(
                (n) =>
                  isElementNode(n) && n.tagName === key && foundNodes.push(n)
              );
              return handleAbsence(parser, foundNodes);
            }
            case "attribute": {
              const foundAttribute =
                isElementNode(node) && node.attributes.getNamedItem(key);
              return handleAbsence(
                parser,
                foundAttribute ? [foundAttribute] : []
              );
            }
            default:
              return unused(parser.type);
          }
        };

        const value = parseValue();

        if (value === null) {
          //no op
        } else if ("success" in value) {
          output[key] = value.success;
        } else {
          errors.push({ object_key: key, error: value });
        }
      }
      if (errors.length) {
        const result: KnownError = {
          error: "while parsing object received the following errors:",
          argument: errors,
        };
        return result;
      } else {
        return { success: output as T };
      }
    });
  };

const withOneNode = <T>(
  nodes: Node[],
  f: (n: Node) => Result<T>
): Result<T> => {
  if (nodes.length < 1) {
    return { error: "insufficiency of nodes" };
  } else if (nodes.length > 1) {
    return { error: "surfeit of nodes" };
  } else {
    return f(nodes[0]);
  }
};

export const parseRoot =
  <T>(name: string, parser: Parser<T>) =>
  (doc: Document): Result<T> => {
    const root: Element = doc.documentElement; // ts types it as HTMLElement which is overprecise, we upcast it to the
    // truth
    if (root.tagName === name) {
      return parser(Array.from([root]));
    } else {
      return {
        error: `root element had name ${root.tagName} but we were asked to parse a root of ${name}`,
      };
    }
  };

export const buildRoot =
  <T>(name: string, builder: Builder<T>) =>
  (blankDocument: Document, val: T) => {
    const rootEle = buildObject({ [name]: { type: "element", builder } })(
      blankDocument,
      { [name]: val }
    );

    return rootEle[0].children[0];
  };

const unused = (u: never): never => {
  throw u;
};
