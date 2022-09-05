import {
  CompileGraphResult,
  filterGraphFromNode,
  Graph,
  GraphNode,
  isDataInput,
} from '../core/graph';
import { NodeInput } from '../core/nodes/core-node';

export type IndexedDataInputs = Record<string, NodeInput[]>;

export type UICompileGraphResult = {
  compileMs: string;
  fragmentResult: string;
  vertexResult: string;
  result: CompileGraphResult;
  dataNodes: Record<string, GraphNode>;
  dataInputs: IndexedDataInputs;
  graph: Graph;
};

export const collectDataInputsFromNodes = (graph: Graph, nodes: GraphNode[]) =>
  nodes.reduce<IndexedDataInputs>((acc, node) => {
    const found = filterGraphFromNode(graph, node, {
      input: isDataInput,
    });
    return { ...acc, ...found.inputs };
  }, {});
