import { generate, parser } from '@shaderfrog/glsl-parser';
import { visit } from '@shaderfrog/glsl-parser/core/ast.js';
import preprocess from '@shaderfrog/glsl-parser/preprocessor';
import { FunctionComponent } from 'react';
import util from 'util';

export interface Scope {
  name: string;
  parent?: Scope;
  bindings: { [name: string]: { references: Array<object> } };
  types: { [key: string]: object };
  functions: { references: Array<object> };
}

export type ShaderAst = Array<{ [key: string]: object | string }>;

export interface Ast {
  scopes: Array<Scope>;
  program: ShaderAst;
}

export const from2To3 = (ast: Ast) => {
  const glOut = 'fragmentColor';
  ast.program.unshift({
    type: 'preprocessor',
    line: '#version 300 es',
    _: '\n',
  });
  ast.program.unshift({
    type: 'declaration_statement',
    declaration: {
      type: 'declarator_list',
      specified_type: {
        type: 'fully_specified_type',
        qualifiers: [{ type: 'keyword', token: 'out', whitespace: ' ' }],
        specifier: {
          type: 'type_specifier',
          specifier: { type: 'keyword', token: 'vec4', whitespace: ' ' },
          quantifier: null,
        },
      },
      declarations: [
        {
          type: 'declaration',
          identifier: {
            type: 'identifier',
            identifier: glOut,
            whitespace: undefined,
          },
          quantifier: null,
          operator: undefined,
          initializer: undefined,
        },
      ],
      commas: [],
    },
    semi: { type: 'literal', literal: ';', whitespace: '\n    ' },
  });
  visit(ast, {
    identifier: {
      enter: (path) => {
        if (path.node.identifier === 'gl_FragColor') {
          path.node.identifier = glOut;
        }
      },
    },
    keyword: {
      enter: (path) => {
        if (
          (path.node.token === 'attribute' || path.node.token === 'varying') &&
          path.findParent((path) => path.node.type === 'declaration_statement')
        ) {
          path.node.token = 'in';
        }
      },
    },
  });
};

// index is a hack because after the descoping, frogOut gets renamed - even
// though it shouldn't because it's not in the global scope, that might be a bug
export const convertMainToReturn = (ast: Ast): void => {
  const mainReturnVar = `frogOut`;

  let outName: string;
  ast.program.find((line, index) => {
    if (
      line.type === 'declaration_statement' &&
      line.declaration?.specified_type?.qualifiers?.find(
        (n) => n.token === 'out'
      ) &&
      line.declaration.specified_type.specifier.specifier.token === 'vec4'
    ) {
      // Remove the out declaration
      ast.program.splice(index, 1);
      outName = line.declaration.declarations[0].identifier.identifier;
      return true;
    }
  });
  if (!outName) {
    throw new Error('No "out vec4" line found in the fragment shader');
  }

  visit(ast, {
    identifier: {
      enter: (path) => {
        if (path.node.identifier === outName) {
          path.node.identifier = mainReturnVar;
          path.node.doNotDescope = true; // hack because this var is in the scope which gets renamed later
        }
      },
    },
    function: {
      enter: (path) => {
        if (path.node.prototype.header.name.identifier === 'main') {
          path.node.prototype.header.returnType.specifier.specifier.token =
            'vec4';
          path.node.body.statements.unshift({
            type: 'literal',
            literal: `vec4 ${mainReturnVar};\n`,
          });
          path.node.body.statements.push({
            type: 'literal',
            literal: `return ${mainReturnVar};\n`,
          });
        }
      },
    },
  });
};

export interface Engine {
  preserve: Set<string>;
  Component: FunctionComponent<{ engine: Engine; parsers: NodeParsers }>;
  nodes: NodeParsers;
}

export const renameBindings = (
  scope: Scope,
  preserve: Set<string>,
  i: number
) => {
  Object.entries(scope.bindings).forEach(([name, binding]) => {
    binding.references.forEach((ref) => {
      if (ref.doNotDescope) {
        return;
      }
      if (ref.type === 'declaration') {
        // both are "in" vars expected in vertex shader
        if (!preserve.has(ref.identifier.identifier)) {
          ref.identifier.identifier = `${ref.identifier.identifier}_${i}`;
        }
      } else if (ref.type === 'identifier') {
        // TODO: does this block get called anymore??
        if (!preserve.has(ref.identifier)) {
          ref.identifier = `${ref.identifier}_${i}`;
        }
      } else if (ref.type === 'parameter_declaration') {
        ref.declaration.identifier.identifier = `${ref.declaration.identifier.identifier}_${i}`;
      } else {
        console.log(ref);
        throw new Error(`Binding for type ${ref.type} not recognized`);
      }
    });
  });
};

export const renameFunctions = (scope: Scope, i: number) => {
  Object.entries(scope.functions).forEach(([name, binding]) => {
    binding.references.forEach((ref) => {
      if (ref.type === 'function_header') {
        ref.name.identifier = `${ref.name.identifier}_${i}`;
      } else if (ref.type === 'function_call') {
        if (ref.identifier.type === 'postfix') {
          ref.identifier.expr.identifier.specifier.identifier = `${ref.identifier.expr.identifier.specifier.identifier}_${i}`;
        } else {
          ref.identifier.specifier.identifier = `${ref.identifier.specifier.identifier}_${i}`;
        }
      } else {
        console.log(ref);
        throw new Error(`Function for type ${ref.type} not recognized`);
      }
    });
  });
};

export interface ProgramSource {
  fragment: string;
  vertex: string;
}

export interface ProgramAst {
  fragment: Ast;
  vertex: string;
}

export interface Node {
  id: string;
  type: ShaderType;
  options: Object;
  inputs: Array<Object>;
  vertexSource: string;
  fragmentSource: string;
}

export const shaderNode = (
  id: string,
  options: Object,
  fragment: string,
  vertex: string
): Node => ({
  id,
  type: ShaderType.shader,
  options,
  inputs: [],
  fragmentSource: fragment,
  vertexSource: vertex,
});

export const outputNode = (id: string, options: Object): Node => ({
  id,
  type: ShaderType.output,
  options,
  inputs: [],
  fragmentSource: `
out vec4 color;
  void main() {
    color = vec4(1.0);
}`,
  vertexSource: '',
});

export const addNode = (id: string, options: Object): Node => ({
  id,
  type: ShaderType.add,
  options,
  inputs: [],
  fragmentSource: `a + b`,
  vertexSource: '',
});

export interface Edge {
  from?: string;
  to: string;
  output?: string;
  input?: string;
}

export interface Graph {
  nodes: Array<Node>;
  edges: Array<Edge>;
}

export enum ShaderType {
  phong = 'MeshPhongMaterial',
  output = 'output',
  shader = 'shader',
  add = 'add',
}

export interface ShaderSections {
  version: Object;
  preprocessor: Array<Object>;
  inStatements: Array<Object>;
  existingIns: Set<string>;
  program: Array<string>;
}

export const makeExpression = (expr: string): object => {
  const ast = parser.parse(
    `void main() {
        main_1();
      }`,
    { quiet: true }
  );
  console.log(util.inspect(ast, false, null, true));
  return ast.program[0].body.statements[0].expression;
};

export const findShaderSections = (ast: Ast): ShaderSections => {
  const [preprocessor, version, program, inStatements, existingIns] =
    ast.program.reduce(
      (split, node) => {
        if (
          node.type === 'declaration_statement' &&
          node.declaration.type === 'precision'
        ) {
          split[0].push(node);
        } else if (node.type === 'preprocessor') {
          split[1].push(node);
        } else if (
          node.type === 'declaration_statement' &&
          node.declaration?.specified_type?.qualifiers?.find(
            (n) => n.token === 'in'
          )
        ) {
          node.declaration.declarations
            .map((decl) => decl.identifier.identifier)
            .forEach((i) => {
              split[4].add(i);
            });
          split[3].push(node);
        } else {
          split[2].push(node);
        }
        return split;
      },
      [[], [], [], [], new Set<string>()]
    );
  return {
    preprocessor,
    version,
    program,
    inStatements,
    existingIns,
  };
};

export const union = (...iterables) => {
  const set = new Set();

  for (const iterable of iterables) {
    for (const item of iterable) {
      set.add(item);
    }
  }

  return set;
};

export const mergeShaderSections = (
  s1: ShaderSections,
  s2: ShaderSections
): ShaderSections => {
  return {
    version: {
      ...s1.version,
      ...s2.version,
    },
    preprocessor: [...s1.preprocessor, ...s2.preprocessor],
    program: [...s1.program, ...s2.program],
    inStatements: [...s1.inStatements, ...s2.inStatements],
    existingIns: union(s1.existingIns, s2.existingIns),
  };
};

export const shaderSectionsToAst = (sections: ShaderSections): Ast => ({
  scopes: [],
  program: {
    type: 'program',
    program: [
      ...Object.entries(sections.version),
      ...sections.preprocessor,
      ...sections.inStatements,
      ...sections.program,
    ],
  },
});

export const outDeclaration = (name: string): Object => ({
  type: 'declaration_statement',
  declaration: {
    type: 'declarator_list',
    specified_type: {
      type: 'fully_specified_type',
      qualifiers: [{ type: 'keyword', token: 'out', whitespace: ' ' }],
      specifier: {
        type: 'type_specifier',
        specifier: { type: 'keyword', token: 'vec4', whitespace: ' ' },
        quantifier: null,
      },
    },
    declarations: [
      {
        type: 'declaration',
        identifier: {
          type: 'identifier',
          identifier: name,
          whitespace: undefined,
        },
        quantifier: null,
        operator: undefined,
        initializer: undefined,
      },
    ],
    commas: [],
  },
  semi: { type: 'literal', literal: ';', whitespace: '\n    ' },
});

// const compose = (graph: Graph, node: Node): ShaderSections => {
//   // TODO: Make into selector fn for graph
//   const inputEdges = graph.edges.filter(
//     (edge) => edge.to === node.id && edge.input === 'color'
//   );
// };

export type NodeReducer = (
  accumulator: any,
  right: Node,
  edge: object | null,
  graph: Graph
) => any;

const reduceNodes = <FnType extends NodeReducer>(
  graph: Graph,
  initial: any,
  node: Node,
  reduce: FnType
) => {
  let result: any;

  const inputEdges = graph.edges.filter((edge) => edge.to === node.id);
  if (!inputEdges.length) {
    result = reduce(initial, node, null, graph);
  } else {
    inputEdges.forEach((edge) => {
      const fromNode = graph.nodes.find((node) => edge.from === node.id);
      if (!fromNode) {
        throw new Error(`No node with id ${edge.from} in graph`);
      }
      result = reduce(
        reduceNodes(graph, initial, fromNode, reduce),
        node,
        edge,
        graph
      );
      // result = reduce(result, fromNode, edge, graph);
    });
  }

  return result;
};

export const reduceGraph = (
  graph: Graph,
  initial: any,
  reduceFn: NodeReducer
) => {
  // Start on the output node
  const output = graph.nodes.find((node) => node.type === 'output');
  if (!output) {
    throw new Error('No output in graph');
  }
  return reduceNodes(graph, initial, output, reduceFn);
};
/*
    if (!output) {
      throw new Error('No output in graph');
    }
    const inputEdges = graph.edges.filter((edge) => edge.to === output.id);
    if (inputEdges.length !== 1) {
      throw new Error('No input to output in');
    }

  const inputEdges = graph.edges.filter((edge) => edge.to === node.id);
  let result = accumulator;

  inputEdges.forEach((edge) => {
    const fromNode = graph.nodes.find((node) => edge.from === node.id);
    if (!fromNode) {
      throw new Error(`No node with id ${edge.from} in graph`);
    }

    result = reduce(accumulator, fromNode);
  });

  return result;
};
*/

/*
export const compile = (
  engine: Engine,
  context: Object,
  parsers: NodeParsers,
  graph: Graph,
  node: Node,
  edge: Edge
): [ShaderSections, ShaderAst] => {
  const inputEdges = graph.edges.filter((edge) => edge.to === node.id);

  let intermediary: ShaderSections = {
    preprocessor: [],
    version: [],
    program: [],
    inStatements: [],
    existingIns: new Set<string>(),
  };
  ``;

  let vertexResult: string = '';
  inputEdges.forEach((edge) => {
    const fromNode = graph.nodes.find((node) => edge.from === node.id);
    if (!fromNode) {
      throw new Error(`No node with id ${edge.from} in graph`);
    }
    const [x, y] = compile(engine, context, parsers, graph, fromNode, edge);
  });

  const parser = parsers[fromNode.type];
  if (!parser) {
    throw new Error(`No parser for type ${fromNode.type}`);
  }
  const { fragment, vertex } = parser.parse(context, fromNode);

  vertexResult = vertex;
  convertMainToReturn(fragment);
  renameBindings(fragment.scopes[0], engine.preserve, 0);
  renameFunctions(fragment.scopes[0], 0);
  const { preprocessor, version, program, inStatements, existingIns } =
    findShaderSections(fragment);
  intermediary.preprocessor = intermediary.preprocessor.concat(preprocessor);
  intermediary.version = version;
  intermediary.inStatements = intermediary.inStatements.concat(inStatements);
  intermediary.existingIns = new Set([
    ...intermediary.existingIns,
    ...existingIns,
  ]);
  intermediary.program = intermediary.program.concat(program);
  // });

  const glOut = 'fragmentColor';

  const fragment =
    generate([
      intermediary.version,
      ...intermediary.preprocessor,
      ...intermediary.inStatements,
      // The outvar
      outDeclaration(glOut),
      ...intermediary.program,
    ]) + `void main() {${glOut} = main_0();}`;

  return {
    vertex: vertexResult,
    fragment,
  };
};
*/

export type NodeParsers = {
  [key in ShaderType]?: {
    parse: (node: Node) => ProgramAst;
  };
};
