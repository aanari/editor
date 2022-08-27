import { EngineNodeType } from '../engine';
import { NodeType, ShaderStage } from '../graph';
import {
  assignemntToStrategy,
  hardCodeStrategy,
  namedAttributeStrategy,
  texture2DStrategy,
  uniformStrategy,
  variableStrategy,
} from '../strategy';
import { BinaryNode, CodeNode, NodeConfig, property } from './code-nodes';
import { UniformDataType } from './data-nodes';

// three last in chain: return gl_position right vec4
// three not last in chain: return returnRight

// other last in chain: return gl_position right vec4
// other not last in chain: return vec4(xxxxxxx, 1.0)

// export interface ProgramSource {
//   fragment: string;
//   vertex: string;
// }

// export interface ProgramAst {
//   fragment: AstNode;
//   vertex: string;
// }

// export interface BinaryNode extends Node {
//   operator: string;
// }

/**
 * TODO: These definitions should live outside of core since I'm trying to
 * refactor out this core folder to only know about nodes with config config,
 * where nodes like output/phong/physical are all configured at the
 * implementation level. "phong" shouldn't be in the core
 */

export const sourceNode = (
  id: string,
  name: string,
  config: NodeConfig,
  source: string,
  stage: ShaderStage,
  originalEngine?: string,
  nextStageNodeId?: string
): CodeNode => ({
  id,
  name,
  type: NodeType.SOURCE,
  config,
  inputs: [],
  outputs: [
    {
      name: 'out',
      category: 'data',
      id: '1',
    },
  ],
  source,
  stage,
  originalEngine,
  nextStageNodeId,
});

export const outputNode = (
  id: string,
  name: string,
  stage: ShaderStage,
  nextStageNodeId?: string
): CodeNode => ({
  id,
  name,
  type: NodeType.OUTPUT,
  config: {
    version: 3,
    preprocess: false,
    inputMapping:
      stage === 'fragment'
        ? {
            frogFragOut: 'color',
          }
        : {
            gl_Position: 'position',
          },
    strategies: [
      assignemntToStrategy(
        stage === 'fragment' ? 'frogFragOut' : 'gl_Position'
      ),
    ],
  },
  inputs: [],
  outputs: [],
  // Consumed by findVec4Constructo4
  source:
    stage === 'fragment'
      ? `
#version 300 es
precision highp float;

out vec4 frogFragOut;
void main() {
  frogFragOut = vec4(1.0);
}
`
      : // gl_Position isn't "out"-able apparently https://stackoverflow.com/a/24425436/743464
        `
#version 300 es
precision highp float;

void main() {
  gl_Position = vec4(1.0);
}
`,
  stage,
  nextStageNodeId,
});

export const expressionNode = (
  id: string,
  name: string,
  source: string
): CodeNode => ({
  id,
  name,
  type: NodeType.SOURCE,
  expressionOnly: true,
  config: {
    version: 3,
    preprocess: false,
    inputMapping: {},
    strategies: [variableStrategy()],
  },
  inputs: [],
  outputs: [
    {
      name: 'out',
      category: 'data',
      id: '1',
    },
  ],
  source,
});

export const phongNode = (
  id: string,
  name: string,
  groupId: string,
  stage: ShaderStage,
  nextStageNodeId?: string
): CodeNode => {
  return {
    id,
    name,
    groupId,
    type: EngineNodeType.phong,
    config: {
      version: 3,
      preprocess: true,
      inputMapping: {
        map: 'albedo',
        normalMap: 'normal',
      },
      strategies: [
        uniformStrategy(),
        stage === 'fragment'
          ? texture2DStrategy()
          : namedAttributeStrategy('position'),
        ...(stage === 'fragment'
          ? [
              hardCodeStrategy([
                {
                  name: 'map',
                  id: 'map',
                  category: 'code',
                  bakeable: false,
                },
                {
                  name: 'normalMap',
                  id: 'normalMap',
                  category: 'code',
                  bakeable: false,
                },
              ]),
            ]
          : []),
      ],
    },
    inputs: [],
    outputs: [
      {
        name: 'out',
        category: 'data',
        id: '1',
      },
    ],
    source: '',
    stage,
    nextStageNodeId,
  };
};

const ALBEDO_DISPLAY_NAME = 'albedo';

export const physicalNode = (
  id: string,
  name: string,
  groupId: string,
  uniforms: UniformDataType[],
  stage: ShaderStage,
  nextStageNodeId?: string
): CodeNode => {
  return {
    id,
    name,
    groupId,
    type: EngineNodeType.physical,
    config: {
      uniforms,
      version: 3,
      preprocess: true,
      inputMapping: {
        map: ALBEDO_DISPLAY_NAME,
        normalMap: 'normal',
      },
      properties: [
        property('map', ALBEDO_DISPLAY_NAME, 'texture'),
        property('normalMap', 'normalMap', 'texture'),
        property('roughnessMap', 'roughnessMap', 'texture'),
        property('displacementMap', 'displacementMap', 'texture'),
        property('envMap', 'envMap', 'texture'),
        property('transmission', 'transmission', 'number'),
        property('sheen', 'sheen', 'number'),
        property('reflectivity', 'reflectivity', 'number'),
        property('clearcoat', 'clearcoat', 'number'),
        property('thickness', 'thickness', 'number'),
      ],
      hardCodedProperties: {
        isMeshPhysicalMaterial: true,
        isMeshStandardMaterial: true,
      },
      // TODO: The strategies for node need to be engine specific :O
      strategies: [
        uniformStrategy(),
        stage === 'fragment'
          ? texture2DStrategy()
          : namedAttributeStrategy('position'),
      ],
    },
    inputs: [],
    outputs: [
      {
        name: 'out',
        category: 'data',
        id: '1',
      },
    ],
    source: '',
    stage,
    nextStageNodeId,
  };
};

export const toonNode = (
  id: string,
  name: string,
  groupId: string,
  stage: ShaderStage,
  nextStageNodeId?: string
): CodeNode => {
  return {
    id,
    name,
    groupId,
    type: EngineNodeType.toon,
    config: {
      version: 3,
      preprocess: true,
      inputMapping: {
        map: 'albedo',
        normalMap: 'normal',
      },
      strategies: [
        uniformStrategy(),
        stage === 'fragment'
          ? texture2DStrategy()
          : namedAttributeStrategy('position'),
        ...(stage === 'fragment'
          ? [
              hardCodeStrategy([
                {
                  name: 'map',
                  id: 'map',
                  category: 'code',
                  bakeable: false,
                },
                {
                  name: 'normalMap',
                  id: 'normalMap',
                  category: 'code',
                  bakeable: false,
                },
              ]),
            ]
          : []),
      ],
    },
    inputs: [],
    outputs: [
      {
        name: 'out',
        category: 'data',
        id: '1',
      },
    ],
    source: '',
    stage,
    nextStageNodeId,
  };
};

export const addNode = (id: string): BinaryNode => ({
  id,
  name: 'add',
  type: NodeType.BINARY,
  config: {
    version: 3,
    preprocess: true,
    strategies: [],
  },
  inputs: [],
  outputs: [
    {
      name: 'out',
      category: 'data',
      id: '1',
    },
  ],
  source: `a + b`,
  operator: '+',
  expressionOnly: true,
  biStage: true,
});

export const multiplyNode = (id: string): BinaryNode => ({
  id,
  name: 'multiply',
  type: NodeType.BINARY,
  config: {
    version: 3,
    preprocess: true,
    strategies: [],
  },
  inputs: [],
  outputs: [
    {
      name: 'out',
      category: 'data',
      id: '1',
    },
  ],
  source: `a * b`,
  operator: '*',
  expressionOnly: true,
  biStage: true,
});
