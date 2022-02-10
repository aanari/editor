import * as BABYLON from 'babylonjs';
import { parser, generate } from '@shaderfrog/glsl-parser';
import {
  renameBindings,
  renameFunctions,
} from '@shaderfrog/glsl-parser/dist/parser/utils';
import { visit, AstNode, NodeVisitors } from '@shaderfrog/glsl-parser/dist/ast';
import preprocess from '@shaderfrog/glsl-parser/dist/preprocessor';
import { Engine, nodeName, EngineContext } from './graph';

import {
  ShaderType,
  convert300MainToReturn,
  makeExpression,
  Node,
  Edge,
  ShaderStage,
  doesLinkThruShader,
  Graph,
  returnGlPositionHardCoded,
  returnGlPosition,
} from './nodestuff';

import babf from './babylon-fragment';
import babv from './babylon-vertex';
import { MutableRefObject } from 'react';

export type RuntimeContext = {
  scene: BABYLON.Scene;
  camera: BABYLON.Camera;
  meshRef: MutableRefObject<BABYLON.Mesh | undefined>;
  BABYLON: any;
  // material: any;
  // index: number;
  // threeTone: any;
  cache: {
    nodes: {
      [id: string]: {
        // fragmentRef: any;
        // vertexRef: any;
        fragment: string;
        vertex: string;
      };
    };
  };
};

let mIdx = 0;
let id = () => mIdx++;
const onBeforeCompileMegaShader = (
  engineContext: EngineContext<RuntimeContext>,
  node: Node
) => {
  const { scene, meshRef } = engineContext.runtime;

  // TODO: match what's in threngine, where they comment this out? Maybe to
  // support changing lights?
  // const { nodes } = engineContext.runtime.cache;
  // if (nodes[node.id] || (node.nextStageNodeId && nodes[node.nextStageNodeId])) {
  //   return;
  // }

  console.log('------------------------- starting onbeforecompile mega shader');
  const shaderMaterial = new BABYLON.PBRMaterial(`spbr${id()}`, scene);

  // Ensures irradiance is computed per fragment to make the
  // Bump visible
  shaderMaterial.forceIrradianceInFragment = true;

  const tex = new BABYLON.Texture('/brick-texture.jpeg', scene);
  shaderMaterial.albedoTexture = tex;
  shaderMaterial.bumpTexture = tex;

  shaderMaterial.albedoColor = new BABYLON.Color3(1.0, 1.0, 1.0);
  shaderMaterial.metallic = 0.1; // set to 1 to only use it from the metallicRoughnessTexture
  shaderMaterial.roughness = 0.1; // set to 1 to only use it from the metallicRoughnessTexture

  let fragmentSource =
    engineContext.runtime.cache.nodes[node.id]?.fragment ||
    engineContext.runtime.cache.nodes[node.nextStageNodeId || 'tttt']?.fragment;
  let vertexSource =
    engineContext.runtime.cache.nodes[node.id]?.vertex ||
    engineContext.runtime.cache.nodes[node.nextStageNodeId || 'tttt']?.vertex;
  console.log(
    '🍃 Creating custom shadermaterial for' + node.id + ` (${node.name})`,
    { fragmentSource, vertexSource }
  );
  shaderMaterial.customShaderNameResolve = (
    shaderName,
    uniforms,
    uniformBuffers,
    samplers,
    defines,
    attributes,
    options
  ) => {
    console.log('🍃 in customshadernameresolve', { defines });
    if (Array.isArray(defines)) {
      defines.push('FAKE_UPDATE_' + id());
    } else {
      // defines['FAKE_UPDATE_' + id()] = true;
      defines.AMBIENTDIRECTUV = 0.0000001 * Math.random();
      // defines._isDirty = true;
    }
    if (options) {
      options.processFinalCode = (type, code) => {
        console.log(
          '🍃 in processFinalCode for ' + node.id + ` (${node.name})`
        );
        if (type === 'vertex') {
          console.log('🍃 BABYLENGINE vertex processFinalCode', {
            code,
            type,
          });
          vertexSource = code;
          return code;
        }
        console.log('🍃 fragment BABYLENGINE processFinalCode', {
          code,
          type,
        });
        fragmentSource = code;
        return code;
      };
    }
    return shaderName;
  };

  if (meshRef.current) {
    console.log('🍃 Calling forceCompilation()....');
    // meshRef.current.material = shaderMaterial;
    shaderMaterial.forceCompilation(meshRef.current);
    scene.render();
  } else {
    console.log('🍃 FCUK no MESHREF RENDER()....');
  }
  console.log('🍃 BABYLERN forceCompilation done()....');
  // shaderMaterial.forceCompilation(meshRef.current);
  // scene.render();
  console.log('🍃 BABYLERN RENDER done', { vertexSource, fragmentSource });

  // const { nodes } = engineContext.runtime.cache;
  // const { renderer, meshRef, scene, camera, material, threeTone, three } =
  //   engineContext.runtime;
  // const mesh = meshRef.current;

  // mesh.material = newMat;
  // console.log('scene', JSON.parse(JSON.stringify(scene)));
  // renderer.compile(scene, camera);

  // // The references to the compiled shaders in WebGL
  // const fragmentRef = renderer.properties
  //   .get(mesh.material)
  //   .programs.values()
  //   .next().value.fragmentShader;
  // const vertexRef = renderer.properties
  //   .get(mesh.material)
  //   .programs.values()
  //   .next().value.vertexShader;

  // const gl = renderer.getContext();
  // const fragment = gl.getShaderSource(fragmentRef);
  // const vertex = gl.getShaderSource(vertexRef);

  // TODO: This is hard coded to not include a b'ump
  engineContext.runtime.cache.nodes[node.id] = {
    // fragmentRef,
    // vertexRef,
    fragment: fragmentSource,
    vertex: vertexSource,
  };
};

const megaShaderProduceVertexAst = (
  // todo: help
  engineContext: EngineContext<RuntimeContext>,
  engine: any,
  graph: Graph,
  node: Node,
  inputEdges: Edge[]
) => {
  const { nodes } = engineContext.runtime.cache;
  const { vertex } =
    nodes[node.id] || (node.nextStageNodeId && nodes[node.nextStageNodeId]);

  engineContext.debuggingNonsense.vertexSource = vertex;

  const vertexPreprocessed = preprocess(vertex, {
    preserve: {
      version: () => true,
    },
  });

  const vertexAst = parser.parse(vertexPreprocessed);
  engineContext.debuggingNonsense.vertexPreprocessed = vertexPreprocessed;

  // Do I need this? Is threejs shader already in 3.00 mode?
  // from2To3(vertexAst);

  if (doesLinkThruShader(graph, node)) {
    returnGlPositionHardCoded(vertexAst, 'vec3', 'transformed');
  } else {
    returnGlPosition(vertexAst);
  }

  renameBindings(vertexAst.scopes[0], (name) =>
    babylengine.preserve.has(name) ? name : `${name}_${node.id}`
  );
  renameFunctions(vertexAst.scopes[0], (name) =>
    name === 'main' ? nodeName(node) : `${name}_${node.id}`
  );
  return vertexAst;
};

const megaShaderFindPositionInputs = (
  engineContext: EngineContext<RuntimeContext>,
  node: Node,
  ast: AstNode
) => ({
  position: (fillerAst: AstNode) => {
    Object.entries(ast.scopes[0].bindings).forEach(
      ([name, binding]: [string, any]) => {
        binding.references.forEach((ref: AstNode) => {
          if (ref.type === 'identifier' && ref.identifier === 'position') {
            ref.identifier = generate(fillerAst);
          } else if (
            ref.type === 'parameter_declaration' &&
            ref.declaration.identifier.identifier === 'position'
          ) {
            ref.declaration.identifier.identifier = generate(fillerAst);
          }
        });
      }
    );
  },
});

const inputNameMap: { [key: string]: string } = {
  albedoSampler: 'albedo',
};
const texture2DInputFinder = (
  engineContext: EngineContext<RuntimeContext>,
  node: Node,
  ast: AstNode
) => {
  let texture2Dcalls: [string, AstNode, string][] = [];
  const visitors: NodeVisitors = {
    function_call: {
      enter: (path) => {
        if (
          // TODO: 100 vs 300
          (path.node.identifier?.specifier?.identifier === 'texture2D' ||
            path.node.identifier?.specifier?.identifier === 'texture') &&
          path.key
        ) {
          if (!path.parent) {
            throw new Error(
              'This is impossible a function call always has a parent'
            );
          }
          texture2Dcalls.push([
            generate(path.node.args[0]),
            path.parent,
            path.key,
          ]);
        }
      },
    },
  };
  visit(ast, visitors);
  const inputs = texture2Dcalls.reduce(
    (inputs, [name, parent, key], index) => ({
      ...inputs,
      [inputNameMap[name] || name]: (fillerAst: AstNode) => {
        parent[key] = fillerAst;
      },
    }),
    {}
  );

  return inputs;
};

export const babylengine: Engine<RuntimeContext> = {
  name: 'babylon',
  mergeOptions: {
    includePrecisions: true,
    includeVersion: false,
  },
  // TODO: Get from uniform lib?
  preserve: new Set<string>([
    'normalMatrix',
    'vAmbientInfos',
    'vOpacityInfos',
    'vEmissiveInfos',
    'vLightmapInfos',
    'vReflectivityInfos',
    'vMicroSurfaceSamplerInfos',
    'vReflectionInfos',
    'vReflectionFilteringInfo',
    'vReflectionPosition',
    'vReflectionSize',
    'vBumpInfos',
    'albedoMatrix',
    'ambientMatrix',
    'opacityMatrix',
    'emissiveMatrix',
    'lightmapMatrix',
    'reflectivityMatrix',
    'microSurfaceSamplerMatrix',
    'bumpMatrix',
    'bumpSampler',
    'vTangentSpaceParams',
    'reflectionMatrix',
    'vReflectionColor',
    'vAlbedoColor',
    'vLightingIntensity',
    'vReflectionMicrosurfaceInfos',
    'pointSize',
    'vReflectivityColor',
    'vEmissiveColor',
    'visibility',
    'vMetallicReflectanceFactors',
    'vMetallicReflectanceInfos',
    'metallicReflectanceMatrix',
    'vClearCoatParams',
    'vClearCoatRefractionParams',
    'vClearCoatInfos',
    'clearCoatMatrix',
    'clearCoatRoughnessMatrix',
    'vClearCoatBumpInfos',
    'vClearCoatTangentSpaceParams',
    'clearCoatBumpMatrix',
    'vClearCoatTintParams',
    'clearCoatColorAtDistance',
    'vClearCoatTintInfos',
    'clearCoatTintMatrix',
    'vAnisotropy',
    'vAnisotropyInfos',
    'anisotropyMatrix',
    'vSheenColor',
    'vSheenRoughness',
    'vSheenInfos',
    'sheenMatrix',
    'sheenRoughnessMatrix',
    'vRefractionMicrosurfaceInfos',
    'vRefractionFilteringInfo',
    'vRefractionInfos',
    'refractionMatrix',
    'vThicknessInfos',
    'thicknessMatrix',
    'vThicknessParam',
    'vDiffusionDistance',
    'vTintColor',
    'vSubSurfaceIntensity',
    'scatteringDiffusionProfile',
    'vDetailInfos',
    'detailMatrix',
    'Scene',
    'vEyePosition',
    'vAmbientColor',
    'vCameraInfos',
    'vPositionW',
    'vMainUV1',
    'vNormalW',
    'Light0',
    'albedoSampler',
    'environmentBrdfSampler',
    'position',
    'normal',
    'uv',
    'world',
    'time',
    // TODO: frag and vert shader get different names for varyings, also the
    // "preserve" in the core graph.ts always reads from the engine which I don't
    // think is what I wanted since my mental model was there was a core engine to use
    'noise',
    'fPosition',
    'fNormal',
  ]),
  parsers: {
    [ShaderType.physical]: {
      onBeforeCompile: (engineContext, node) => {
        // const { three } = engineContext.runtime;
        onBeforeCompileMegaShader(
          engineContext,
          node
          // new three.MeshPhongMaterial({
          //   color: 0x00ff00,
          //   map: new three.Texture(),
          // })
          // new three.MeshPhysicalMaterial({
          //   color: 0x00ff00,
          //   roughness: 0.046,
          //   metalness: 0.491,
          //   clearcoat: 1,
          //   map: new three.Texture(),
          // })
        );
      },
      fragment: {
        produceAst: (
          // todo: help
          engineContext,
          engine,
          graph,
          node,
          inputEdges
        ) => {
          const { fragment } = engineContext.runtime.cache.nodes[node.id];

          const fragmentPreprocessed = preprocess(fragment, {
            preserve: {
              version: () => true,
            },
          });

          const fragmentAst = parser.parse(fragmentPreprocessed);

          // Used for the UI only right now
          engineContext.debuggingNonsense.fragmentPreprocessed =
            fragmentPreprocessed;
          engineContext.debuggingNonsense.fragmentSource = fragment;

          // Do I need this? Is threejs shader already in 3.00 mode?
          // from2To3(fragmentAst);

          convert300MainToReturn(fragmentAst);
          renameBindings(fragmentAst.scopes[0], (name) =>
            babylengine.preserve.has(name) ? name : `${name}_${node.id}`
          );
          renameFunctions(fragmentAst.scopes[0], (name) =>
            name === 'main' ? nodeName(node) : `${name}_${node.id}`
          );
          return fragmentAst;
        },
        findInputs: texture2DInputFinder,
        produceFiller: (node: Node, ast: AstNode) => {
          return makeExpression(`${nodeName(node)}()`);
        },
      },
      vertex: {
        produceAst: megaShaderProduceVertexAst,
        findInputs: megaShaderFindPositionInputs,
        produceFiller: (node: Node, ast: AstNode) => {
          return makeExpression(`${nodeName(node)}()`);
        },
      },
    },
  },
};

babylengine.parsers[ShaderType.toon] = babylengine.parsers[ShaderType.physical];
babylengine.parsers[ShaderType.phong] =
  babylengine.parsers[ShaderType.physical];
