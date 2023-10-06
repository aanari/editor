import * as pc from 'playcanvas';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  mangleVar,
  SamplerCubeNode,
  TextureNode,
  evaluateNode,
} from '@core/graph';
import {
  EngineContext,
  collectInitialEvaluatedGraphProperties,
} from '@core/engine';
import styles from '../../editor/styles/editor.module.css';

import { usePrevious } from '../../editor/hooks/usePrevious';
import { useSize } from '../../editor/hooks/useSize';

import {
  defaultPropertySetting,
  physicalDefaultProperties,
  playengine,
} from '@core/plugins/playcanvas/playengine';
import { usePlayCanvas } from './usePlayCanvas';
import { SceneProps } from '@editor/editor/components/Editor';

export type PreviewLight = 'point' | '3point' | 'spot';

let mIdx = 0;
let id = () => mIdx++;

const log = (...args: any[]) =>
  console.log.call(console, '\x1b[36m(pc.component)\x1b[0m', ...args);

const copyUIntToImageData = (data: Uint8Array, imageData: ImageData) => {
  for (let i = 0; i < data.length; i += 4) {
    let index = data.length - i; // flip how data is read
    imageData.data[index] = data[i]; //red
    imageData.data[index + 1] = data[i + 1]; //green
    imageData.data[index + 2] = data[i + 2]; //blue
    imageData.data[index + 3] = data[i + 3]; //alpha
  }
};

// Intercept console errors, which is the only way to get playcanvas shader
// error logs
const consoleError = console.error;
let callback: Function;
console.error = (...args: any[]) => {
  if (callback) {
    callback(...args);
  }
  return consoleError.apply(console, args);
};

export const SceneAngles = {
  TOP_LEFT: 'topleft',
  TOP_MIDDLE: 'topmid',
  TOP_RIGHT: 'topright',
  MIDDLE_LEFT: 'midleft',
  MIDDLE_MIDDLE: 'midmid',
  MIDDLE_RIGHT: 'midright',
  BOTTOM_LEFT: 'botleft',
  BOTTOM_MIDDLE: 'botmid',
  BOTTOM_RIGHT: 'botright',
};

const calculateViewPosition =
  (xPosition: number, yPosition: number) => (radius: number) => {
    const spread = 0.8;
    const position = new pc.Vec3(0, 0, radius);
    return position;
  };

export const SceneAngleVectors = {
  [SceneAngles.TOP_LEFT]: calculateViewPosition(-1, -1),
  [SceneAngles.TOP_MIDDLE]: calculateViewPosition(0, -1),
  [SceneAngles.TOP_RIGHT]: calculateViewPosition(1, -1),
  [SceneAngles.MIDDLE_LEFT]: calculateViewPosition(-1, 0),
  [SceneAngles.MIDDLE_MIDDLE]: calculateViewPosition(0, 0),
  [SceneAngles.MIDDLE_RIGHT]: calculateViewPosition(1, 0),
  [SceneAngles.BOTTOM_LEFT]: calculateViewPosition(-1, 1),
  [SceneAngles.BOTTOM_MIDDLE]: calculateViewPosition(0, 1),
  [SceneAngles.BOTTOM_RIGHT]: calculateViewPosition(1, 1),
};

export const SceneDefaultAngles: Record<string, string> = {
  sphere: SceneAngles.MIDDLE_MIDDLE,
  cube: SceneAngles.TOP_LEFT,
  torusknot: SceneAngles.MIDDLE_MIDDLE,
  torus: SceneAngles.BOTTOM_MIDDLE,
  teapot: SceneAngles.MIDDLE_MIDDLE,
  bunny: SceneAngles.MIDDLE_MIDDLE,
  icosahedron: SceneAngles.MIDDLE_MIDDLE,
  plane: SceneAngles.MIDDLE_MIDDLE,
  cylinder: SceneAngles.TOP_MIDDLE,
  cone: SceneAngles.MIDDLE_MIDDLE,
};

export const CameraDistances: Record<string, number> = {
  sphere: 1,
  cube: 1.5,
  torusknot: 2.5,
  icosahedron: 2.5,
  torus: 0.8,
  teapot: 2.9,
  bunny: 2.54,
  plane: 0.7,
  cylinder: 2.38,
  cone: 2.35,
};

const makeLightHelper = () => {
  const entity = new pc.Entity('render');
  entity.addComponent('model', {
    type: 'box',
  });
  entity.setLocalScale(0.1, 0.1, 0.1);
  entity.rotate(45, 45, 0);
  entity.model!.model.generateWireframe();
  entity.model!.meshInstances.forEach((mi) => {
    mi.renderStyle = 1;
    mi.material = mi.material.clone();
    // @ts-ignore lol
    mi.material.diffuse.set(0, 0, 0, 0);
    // @ts-ignore lol
    mi.material.specular.set(0, 0, 0, 0);
    // @ts-ignore lol
    mi.material.shininess = 0;
    // @ts-ignore lol
    mi.material.emissive.set(1, 1, 1, 1);
    mi.material.update();
  });
  return entity;
};

/**
 * MONKEYPATCH WARNING! We need to overwrite the GLSL generated by PlayCanvas in
 * their materials. This function overwrites the core generateShaderDefinition()
 * call, and lets this component define an intercept function.
 */
const RUNTIME_CHUNK_HACK_NAME = 'runtimeHackSource';
let hackShaderDefinition: (event: {
  userMaterialId: string;
  shaderPassInfo: any;
  definition: any;
}) => void;

const loadAsset = (
  app: pc.Application,
  name: string,
  url: string
): Promise<pc.Asset> =>
  new Promise((resolve) => {
    const cubemapAsset = new pc.Asset(
      name,
      'cubemap',
      {
        url,
      },
      {}
    );

    app.assets.add(cubemapAsset);
    app.assets.load(cubemapAsset);
    cubemapAsset.ready(() => resolve(cubemapAsset));
  });

const buildTextureLoader =
  (app: pc.Application) =>
  async (path: string): Promise<pc.Texture> =>
    new Promise((resolve) => {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      const texture = new pc.Texture(app.graphicsDevice, { name: path });
      image.onload = () => {
        texture.setSource(image);
        resolve(texture);
      };
      image.src = path;
    });

const PlayCanvasComponent: React.FC<SceneProps> = ({
  compile,
  compileResult,
  graph,
  lights,
  setLights,
  animatedLights,
  setAnimatedLights,
  previewObject,
  setCtx,
  setGlResult,
  setPreviewObject,
  bg,
  setBg,
  showHelpers,
  setShowHelpers,
  width,
  height,
  assetPrefix,
  takeScreenshotRef,
}) => {
  const path = useCallback((src: string) => assetPrefix + src, [assetPrefix]);
  const sceneWrapper = useRef<HTMLDivElement>(null);
  const size = useSize(sceneWrapper);

  useEffect(() => {
    callback = (msg: string) => {
      if (msg.toString().startsWith('Failed to compile')) {
        const type = (msg.match(/compile (\w+)/) as string[])[1];
        const err = msg.replace(/.*shader:\n+/m, '').replace(/\n[\s\S]*/m, '');
        setGlResult({
          fragError: type === 'fragment' ? err : null,
          vertError: type === 'vertex' ? err : null,
          programError: '',
        });
      }
    };
  }, [setGlResult]);

  const { camera, canvas, pcDomRef, app, sceneData, loadingMaterial } =
    usePlayCanvas((deltaTime) => {
      const { mesh } = sceneData;
      const meshInstance = mesh?.render?.meshInstances?.[0];
      const { material: mMaterial } = meshInstance || {};
      const material = mMaterial as pc.StandardMaterial;
      if (!mesh || !meshInstance || !material) {
        return;
      }

      material.setParameter('time', performance.now() * 0.001);

      // Note the uniforms are updated here every frame, but also instantiated
      // in this component at RawShaderMaterial creation time. There might be
      // some logic duplication to worry about.
      if (textures && compileResult?.dataInputs && material) {
        Object.entries(compileResult.dataInputs).forEach(([nodeId, inputs]) => {
          const node = graph.nodes.find(({ id }) => id === nodeId);
          if (!node) {
            console.warn(
              'While populating uniforms, no node was found from dataInputs',
              { nodeId, dataInputs: compileResult.dataInputs, graph }
            );
            return;
          }
          inputs.forEach((input) => {
            const edge = graph.edges.find(
              ({ to, input: i }) => to === nodeId && i === input.id
            );
            if (edge) {
              const fromNode = graph.nodes.find(({ id }) => id === edge.from);
              // In the case where a node has been deleted from the graph,
              // dataInputs won't have been udpated until a recompile completes
              if (!fromNode) {
                return;
              }

              let value;
              // THIS DUPLICATES OTHER LINE
              try {
                value = evaluateNode(playengine, graph, fromNode);
              } catch (err) {
                console.warn(
                  `Tried to evaluate a non-data node! ${input.displayName} on ${node.name}`
                );
                return;
              }
              let newValue = value;
              if (fromNode.type === 'texture') {
                // THIS DUPLICATES OTHER LINE, used for runtime uniform setting
                newValue = textures[(fromNode as TextureNode).value];
                // console.log('setting texture', newValue, 'from', fromNode);
              }
              if (fromNode.type === 'samplerCube') {
                newValue = textures[(fromNode as SamplerCubeNode).value];
              }

              if (input.type === 'property' && input.property) {
                // @ts-ignore
                material[input.property] = newValue;
              } else {
                // TODO: This doesn't work for engine variables because
                // those aren't suffixed
                const name = mangleVar(input.displayName, playengine, node);
                material.setParameter(name, newValue);
                meshInstance.setParameter(name, newValue);
              }
            }
          });
        });

        material.update();
      }

      const { lights: lightMeshes } = sceneData;
      const time = Date.now();
      if (animatedLights) {
        if (lights === 'point') {
          const light = lightMeshes[0];
          light.setPosition(
            1.0 * Math.sin(time * 0.001),
            1.0 * Math.cos(time * 0.001),
            1.0
          );
          if (showHelpers) {
            const p = light.getPosition();
            lightMeshes[1].setPosition(p.x, p.y, p.z);
          }
        } else if (lights === '3point') {
          const group = lightMeshes[0];
          group.rotate(deltaTime * 20.0, deltaTime * 20.0, deltaTime * 20.0);
        }
      }
    });

  const [textures, setTextures] = useState<
    Record<string, pc.Texture | pc.Asset | null> | undefined
  >();
  useEffect(() => {
    const load = async () => {
      const textureLoader = buildTextureLoader(app);
      // Logging to check if this happens more than once
      log('🔥 Loading Playcanvas textures');
      setTextures({
        explosion: await textureLoader(path('/explosion.png')),
        'grayscale-noise': await textureLoader(path('/grayscale-noise.png')),
        threeTone: await textureLoader(path('/3tone.jpg')),
        brick: await textureLoader(path('/bricks.jpeg')),
        brickNormal: await textureLoader(path('/bricknormal.jpeg')),
        pebbles: await textureLoader(path('/Big_pebbles_pxr128.jpeg')),
        pebblesNormal: await textureLoader(
          path('/Big_pebbles_pxr128_normal.jpeg')
        ),
        pebblesBump: await textureLoader(path('/Big_pebbles_pxr128_bmp.jpeg')),
        testNormal: await textureLoader(path('/testNormalMap.png')),
        testBump: await textureLoader(path('/testBumpMap.png')),
        pondCubeMap: null,
        cityCourtYard: await loadAsset(
          app,
          'city',
          path('/envmaps/citycourtyard.dds')
        ),
        warehouseEnvTexture: await loadAsset(
          app,
          'city',
          path('/envmaps/room.hdr')
        ),
      });
    };
    load();
  }, [path, app]);

  useEffect(() => {
    app.graphicsDevice.on('shader:generate', (info) => {
      hackShaderDefinition && hackShaderDefinition(info);
      return () => {
        app.graphicsDevice.off('shader:generate');
      };
    });
  }, [app, textures]);

  const [ctx] = useState<EngineContext>(() => {
    return {
      engine: 'playcanvas',
      runtime: {
        sceneData,
        // i'm not intentionally putting some things on scenedata and others on
        // runtime, it's just hacking to test out playcanvas
        app,
        textures,
        cache: { nodes: {}, data: {} },
      },
      nodes: {},
      debuggingNonsense: {},
    };
  });

  const prevLights = usePrevious(lights);
  const previousShowHelpers = usePrevious(showHelpers);
  useEffect(() => {
    if (
      (prevLights === lights && previousShowHelpers === showHelpers) ||
      (prevLights === undefined && sceneData.lights.length)
    ) {
      return;
    }
    sceneData.lights.forEach((light) => light.destroy());

    if (lights === 'point') {
      const pointLight = new pc.Entity('light');
      pointLight.addComponent('light', {
        type: 'omni',
        color: new pc.Color(1, 1, 1),
        range: 10,
      });
      pointLight.setPosition(0, 0, 3);
      sceneData.lights = [pointLight];

      if (showHelpers) {
        sceneData.lights.push(makeLightHelper());
      }
    } else if (lights === '3point') {
      const group = new pc.Entity('group');

      const light1 = new pc.Entity('light');
      light1.addComponent('light', {
        type: 'omni',
        color: new pc.Color(1, 1, 1),
        range: 10,
      });
      light1.setPosition(2, -2, 0);

      const light2 = new pc.Entity('light');
      light2.addComponent('light', {
        type: 'omni',
        color: new pc.Color(1, 1, 1),
        range: 10,
      });
      light2.setPosition(-1, 2, 1);

      const light3 = new pc.Entity('light');
      light3.addComponent('light', {
        type: 'omni',
        color: new pc.Color(1, 1, 1),
        range: 10,
      });
      light3.setPosition(-1, -2, -2);

      let lights = [light1, light2, light3];

      if (showHelpers) {
        const h1 = makeLightHelper();
        h1.setPosition(light1.getPosition());
        const h2 = makeLightHelper();
        h2.setPosition(light2.getPosition());
        const h3 = makeLightHelper();
        h3.setPosition(light3.getPosition());
        lights = lights.concat(h1, h2, h3);
      }
      lights.forEach((light) => {
        group.addChild(light);
      });

      sceneData.lights = [group];
    } else if (lights === 'spot') {
      const spot1 = new pc.Entity();
      spot1.addComponent('light', {
        type: 'spot',
        // new BABYLON.Vector3(0, 0, 2),
        // new BABYLON.Vector3(0, 0, -1),
      });
      spot1.setPosition(0, 0, 2);
      // spot1.diffuse = new BABYLON.Color3(0, 1, 0);
      // spot1.specular = new BABYLON.Color3(0, 1, 0);

      const spot2 = new pc.Entity();
      spot2.addComponent('light', {
        type: 'spot',
        // new BABYLON.Vector3(0, 0, 2),
        // new BABYLON.Vector3(0, 0, -1),
      });
      spot2.setPosition(0, 0, 2);
      // spot2.diffuse = new BABYLON.Color3(1, 0, 0);
      // spot2.specular = new BABYLON.Color3(1, 0, 0);

      sceneData.lights = [spot1, spot2];

      if (showHelpers) {
      }
    }

    sceneData.lights.forEach((obj) => {
      app.root.addChild(obj);
    });

    if (prevLights && prevLights !== undefined && prevLights !== lights) {
      if (sceneData.mesh && sceneData.mesh.render) {
        sceneData.mesh.render.meshInstances[0].material = loadingMaterial;
      }
      compile(ctx);
    }
  }, [
    app,
    sceneData,
    prevLights,
    lights,
    compile,
    ctx,
    previousShowHelpers,
    showHelpers,
    loadingMaterial,
  ]);

  useEffect(() => {
    let entity = new pc.Entity();

    const material =
      sceneData.mesh && sceneData.mesh.render
        ? sceneData.mesh.render.meshInstances[0].material
        : loadingMaterial;

    if (previewObject === 'torus') {
      const mesh = pc.createTorus(app.graphicsDevice, {
        segments: 60,
        sides: 32,
      });
      entity.rotate(90, 0, 0);
      const meshInstance = new pc.MeshInstance(mesh, material);
      entity.addComponent('render', {
        meshInstances: [meshInstance],
      });
    } else if (previewObject === 'plane') {
      const mesh = pc.createPlane(app.graphicsDevice, {
        widthSegments: 60,
        lengthSegments: 60,
      });
      const meshInstance = new pc.MeshInstance(mesh, material);
      entity.addComponent('render', {
        meshInstances: [meshInstance],
      });
      entity.rotate(90, 0, 0);
    } else if (previewObject === 'cube') {
      const mesh = pc.createBox(app.graphicsDevice, {
        widthSegments: 60,
        heightSegments: 60,
      });
      const meshInstance = new pc.MeshInstance(mesh, material);
      entity.addComponent('render', {
        meshInstances: [meshInstance],
      });
    } else if (previewObject === 'sphere') {
      const mesh = pc.createSphere(app.graphicsDevice, {
        latitudeBands: 128,
        longitudeBands: 128,
      });
      const meshInstance = new pc.MeshInstance(mesh, material);
      entity.addComponent('render', {
        meshInstances: [meshInstance],
      });
    } else {
      throw new Error('fffffff');
    }

    if (sceneData.mesh && sceneData.mesh.render) {
      const origMat = sceneData.mesh.render.meshInstances[0].material;
      entity.render!.material = origMat;
    } else {
      entity.render!.material = loadingMaterial;
    }

    if (sceneData.mesh) {
      sceneData.mesh.destroy();
    }
    app.root.addChild(entity);
    sceneData.mesh = entity;
    // @ts-ignore
    window.mesh = entity;
  }, [app, previewObject, sceneData, loadingMaterial, camera]);

  const hasSetctx = useRef(false);
  const previousBg = usePrevious(bg);
  const previousTextures = usePrevious(textures);
  useEffect(() => {
    if (!textures || (textures === previousTextures && bg === previousBg)) {
      return;
    }
    const newBg = bg ? (textures[bg] as pc.Asset).resources : null;
    app.scene.setSkybox(newBg as pc.Texture[]);

    if (!hasSetctx.current) {
      hasSetctx.current = true;
      setCtx(ctx);
    }
  }, [
    bg,
    previousBg,
    sceneData,
    previewObject,
    textures,
    previousTextures,
    app,
    ctx,
    setCtx,
  ]);

  useEffect(() => {
    if (!canvas) {
      return;
    }
    canvas.width = width;
    canvas.height = height;
    app.resizeCanvas(width, height);
  }, [app, canvas, width, height]);

  useEffect(() => {
    if (!compileResult?.fragmentResult || !app?.graphicsDevice) {
      return;
    }
    const { graph } = compileResult;

    const pbrName = `component_playcanvas_${id()}`;
    log('🛠 Re-creating Playcanvas material', {
      pbrName,
      compileResult,
    });

    // Get runtime data properties to set on new shader
    const graphProperties = collectInitialEvaluatedGraphProperties(
      playengine,
      graph,
      defaultPropertySetting.bind(null, app)
    );

    setGlResult({
      fragError: null,
      vertError: null,
      programError: null,
    });

    const shaderMaterial = new pc.StandardMaterial();

    const newProperties = {
      ...physicalDefaultProperties,
      ...graphProperties,
      opacity: 1,
      userId: 'shaderfrog',
    };
    log('PlayCanvasEngine material props:', newProperties);
    Object.assign(shaderMaterial, newProperties);

    hackShaderDefinition = (info) => {
      log('Hacking the shader definition!', info);
      if (info.userMaterialId === 'shaderfrog') {
        info.definition.fshader =
          '#version 300 es\n' + compileResult.fragmentResult;
        info.definition.vshader =
          '#version 300 es\n' + compileResult.vertexResult;
      }
    };

    shaderMaterial.chunks[RUNTIME_CHUNK_HACK_NAME] = `${Math.random()}`;

    shaderMaterial.update();

    if (sceneData.mesh) {
      const mis = sceneData?.mesh?.render?.meshInstances || [];
      if (mis.length !== 1) {
        console.error('Too many mesh instances!', mis);
        throw new Error('Too many mesh instances!');
      }
      mis[0].material = shaderMaterial;
      log('created new materialId:', shaderMaterial.id);
    } else {
      console.warn('No mesh to assign the material to!');
    }
  }, [setGlResult, compileResult, sceneData, app, textures]);

  takeScreenshotRef.current = useCallback(async () => {
    const viewAngle = SceneDefaultAngles[previewObject];

    const screenshotHeight = 400;
    const screenshotWidth = 400;

    const device = app.graphicsDevice;

    // Create a new texture based on the current width and height
    const colorBuffer = new pc.Texture(device, {
      width: screenshotWidth,
      height: screenshotHeight,
      format: pc.PIXELFORMAT_R8_G8_B8_A8,
    });

    const depthBuffer = new pc.Texture(device, {
      format: pc.PIXELFORMAT_DEPTHSTENCIL,
      width: screenshotWidth,
      height: screenshotHeight,
      mipmaps: false,
      addressU: pc.ADDRESS_CLAMP_TO_EDGE,
      addressV: pc.ADDRESS_CLAMP_TO_EDGE,
    });

    colorBuffer.minFilter = pc.FILTER_LINEAR;
    colorBuffer.magFilter = pc.FILTER_LINEAR;
    const renderTarget = new pc.RenderTarget({
      colorBuffer: colorBuffer,
      depthBuffer: depthBuffer,
      samples: 4, // Enable anti-alias
    });

    const camera = new pc.Entity('camera');
    camera.addComponent('camera', {
      fov: 75,
      frustumCulling: true,
      clearColor: new pc.Color(0, 0, 0, 0),
    });
    const pos = SceneAngleVectors[viewAngle](CameraDistances[previewObject]);
    camera.setPosition(pos.x, pos.y, pos.z);
    app.root.addChild(camera);

    camera.camera!.renderTarget = renderTarget;

    const canvas = window.document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('No context');
    }

    canvas.width = screenshotWidth;
    canvas.height = screenshotHeight;

    const imageData = context.createImageData(
      screenshotWidth,
      screenshotHeight
    );

    const pixels = new Uint8Array(screenshotWidth * screenshotHeight * 4);
    app.render();

    // @ts-ignore
    const gl = app.graphicsDevice.gl;
    // @ts-ignore
    const fb = app.graphicsDevice.gl.createFramebuffer();

    // We are accessing a private property here that has changed between
    // Engine v1.51.7 and v1.52.2
    const colorGlTexture = colorBuffer.impl
      ? colorBuffer.impl._glTexture
      : // @ts-ignore
        colorBuffer._glTexture;
    const depthGlTexture = depthBuffer.impl
      ? depthBuffer.impl._glTexture
      : // @ts-ignore
        depthBuffer._glTexture;

    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      colorGlTexture,
      0
    );
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.DEPTH_STENCIL_ATTACHMENT,
      gl.TEXTURE_2D,
      depthGlTexture,
      0
    );
    gl.readPixels(
      0,
      0,
      screenshotWidth,
      screenshotHeight,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      pixels
    );

    gl.deleteFramebuffer(fb);

    copyUIntToImageData(pixels, imageData);
    context.putImageData(imageData, 0, 0);

    const data = canvas.toDataURL('image/jpeg', 0.9);
    app.root.removeChild(camera);

    return data;
  }, [previewObject, app]);

  return (
    <>
      <div className={styles.sceneControls}>
        <div className={styles.controlGrid}>
          <div>
            <label htmlFor="Lightingsfs" className="label noselect">
              <span>Lighting</span>
            </label>
          </div>
          <div>
            <select
              id="Lightingsfs"
              className="select"
              onChange={(event) => {
                setLights(event.target.value);
              }}
              value={lights}
            >
              <option value="point">Single Point Light</option>
              <option value="3point">Multiple Point Lights</option>
              {/* <option value="spot">Spot Lights</option> */}
            </select>
          </div>

          <div className="grid span2">
            <div className={styles.controlGrid}>
              <div>
                <input
                  className="checkbox"
                  id="shp"
                  type="checkbox"
                  checked={showHelpers}
                  onChange={(event) => setShowHelpers(event?.target.checked)}
                />
              </div>
              <div>
                <label className="label noselect" htmlFor="shp">
                  <span>Lighting Helpers</span>
                </label>
              </div>
            </div>
            <div className={styles.controlGrid}>
              <div>
                <input
                  className="checkbox"
                  id="sha"
                  type="checkbox"
                  checked={animatedLights}
                  onChange={(event) => setAnimatedLights(event?.target.checked)}
                />
              </div>
              <div>
                <label className="label noselect" htmlFor="sha">
                  <span>Animate</span>
                </label>
              </div>
            </div>
          </div>

          <div>
            <label htmlFor="Modelsfs" className="label noselect">
              <span>Model</span>
            </label>
          </div>
          <div>
            <select
              id="Modelsfs"
              className="select"
              onChange={(event) => {
                setPreviewObject(event.target.value);
              }}
              value={previewObject}
            >
              <option value="sphere">Sphere</option>
              <option value="cube">Cube</option>
              <option value="plane">Plane</option>
              <option value="torus">Torus</option>
            </select>
          </div>

          <div>
            <label htmlFor="Backgroundsfs" className="label noselect">
              <span>Background</span>
            </label>
          </div>
          <div>
            <select
              id="Backgroundsfs"
              className="select"
              onChange={(event) => {
                setBg(
                  event.target.value === 'none' ? null : event.target.value
                );
              }}
              value={bg ? bg : 'none'}
            >
              <option value="none">None</option>
              <option value="cityCourtYard">City Court Yard</option>
              <option value="warehouseEnvTexture">Horrible Lord?</option>
            </select>
          </div>
        </div>
      </div>

      <div ref={pcDomRef} className={styles.sceneContainer}></div>
    </>
  );
};

export default PlayCanvasComponent;
