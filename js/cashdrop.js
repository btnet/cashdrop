"use strict";
const xhr = new XMLHttpRequest();
const socket = io("https://cashexplorer.bitcoin.com/");

const canvas = document.getElementById("renderCanvas");
const engine = new BABYLON.Engine(canvas, true);
const bccStatus = document.getElementById("status");
const txInfo = document.getElementById("txInfo");
const bccLogo = document.getElementById("bccLogo");
const soundMute = document.getElementById("soundMute");
const coinColor = document.getElementById("coinColor");
const disableSD = document.getElementById("disableSD");
const txRef = document.getElementById("txRef");

let shadows = [];

let coinMaterial, coinDonationMaterial, coinSDMaterial, groundMaterial, sideMaterial, blockMaterial, edgeMaterial; // materials
let coinParent, ground; // global meshes
let lastPicked, infoPlane, infoTexture, infoText, infoRect, highlight; // vars for GUI
let soundDrop, soundDonation, soundWoosh, soundSD;

// *************************************************************************************************************
// CONNECT TO BITCOIN.COM CASHEXPLORER WEBSOCKET FOR INCOMMING TRANSACTIONS & INITIATE NEW BLOCK FOUND SEQUENCE
// *************************************************************************************************************
socket.on("connect", function() {
    socket.emit("subscribe", "inv");
});

socket.on("tx", function (data) {

    xhr.open('GET', "https://cashexplorer.bitcoin.com/api/tx/" + data.txid, true);
    xhr.send();

    xhr.onreadystatechange = function () {
        if (this.readyState == 4 && this.status == 200) {
            let obj = JSON.parse(this.responseText);

            createTransaction(data.valueOut, data.txid, data.vout, obj.size);
        }
    }

    //if (txRef.checked) {
        
        
    //} else {
    //    createTransaction(data.valueOut, data.txid, data.vout);
    //}
});

socket.on("block", function (data) {
    xhr.open('GET', "https://cashexplorer.bitcoin.com/api/block/" + data, true);
	xhr.send();

    xhr.onreadystatechange = function () {
        if (this.readyState == 4 && this.status == 200) {
            let obj = JSON.parse(this.responseText);
            createBlock(obj.tx);
            updateStatusText();
        }
    }

});

// ******************************
// INITIAL CREATION OF THE SCENE
// ******************************
var createScene = function() {
	var scene = new BABYLON.Scene(engine);
    
	// create skybox & skybox material
    var skybox = BABYLON.Mesh.CreateBox("skyBox", 100.0, scene);
    var skyboxMaterial = new BABYLON.StandardMaterial("skyBoxMaterial", scene);
    skybox.position.y = -10;
    skybox.renderingGroupId = 0;
    skybox.infiniteDistance = true;
    skyboxMaterial.backFaceCulling = false;
    skyboxMaterial.disableLighting = true;
    skyboxMaterial.reflectionTexture = new BABYLON.CubeTexture("assets/textures/skybox", scene);
    skyboxMaterial.reflectionTexture.coordinatesMode = BABYLON.Texture.SKYBOX_MODE;
    skybox.material = skyboxMaterial;

    // highlight for coin selection
    highlight = new BABYLON.HighlightLayer("highlight", scene);

	// create camera
	var camera = new BABYLON.ArcRotateCamera("ArcRotateCamera", 4.75, 1.3, 15, new BABYLON.Vector3(0, -1, 0), scene);
	camera.lowerBetaLimit = 0.1;
	camera.upperBetaLimit = (Math.PI / 2) * 0.9;
	camera.lowerRadiusLimit = 5;
	camera.upperRadiusLimit = 30;
	camera.wheelPrecision = 30;
	camera.pinchPrecision = 30;
	camera.attachControl(canvas, true);

    
	// lights
	setLights();

	// Create and set Materials
	setMaterials();
	
	// physics
	var physicsPlugin = new BABYLON.CannonJSPlugin();
    scene.enablePhysics(undefined, physicsPlugin);
	scene.enablePhysics();	
	
	// Add Ground to scene
	var numberOfSides = 32;
    var diameter = 10;

	ground = BABYLON.Mesh.CreateCylinder("ground", 0.5, diameter, diameter, numberOfSides, 1, scene);
    ground.position.y = -2;
    groundMaterial.reflectionTexture = new BABYLON.MirrorTexture("mirror", 512, scene, true); //Create a mirror texture
    groundMaterial.reflectionTexture.mirrorPlane = new BABYLON.Plane(0, -5.75, 0, -10.0);

    groundMaterial.reflectionTexture.level = 0.1;
    groundMaterial.reflectionTexture.renderList = [skybox];
    ground.receiveShadows = true;
    ground.material = groundMaterial;
	ground.physicsImpostor = new BABYLON.PhysicsImpostor(ground, BABYLON.PhysicsImpostor.BoxImpostor, { mass: 0, restitution: 0.2 }, scene);

    // add sides to the ground
    createSides(numberOfSides, diameter);

    // create coinparent for cloning
	coinParent = createParentCoin();

    // create UI for coin click info
    setUI();

    // set sound
    soundDrop = new BABYLON.Sound("CoinDrop", "assets/sounds/drop.wav", scene);
    soundDonation = new BABYLON.Sound("Donation", "assets/sounds/woohoo.wav", scene);
    soundWoosh = new BABYLON.Sound("Woosh", "assets/sounds/woosh.wav", scene);
    soundSD = new BABYLON.Sound("SatoshiDice", "assets/sounds/sd_coin.wav", scene);
    
    // scene debugger
    BABYLON.DebugLayer.InspectorURL = "https://cdn.babylonjs.com/inspector/babylon.inspector.bundle.js";

    // checks every 300ms if physics objects are not moving and sets to static
    // might be temporary if coins misbehave when there are lots of them
    let f = 0;
    scene.registerBeforeRender(() => {
        if (!(f % 300)) {
            scene.meshes.forEach((m) => {
                if (m.physicsImpostor != undefined &&
                    m.name != "ground" &&
                    m.name != "sides" &&
                    m.physicsImpostor.mass != 0 &&
                    m.physicsImpostor.physicsBody.velocity.norm() < 0.001) m.physicsImpostor.mass = 0;
            });
        }
        // reset counter
        if (f == 299) {
            f = 0;
        } else {
            f++;
        }
    });

    BABYLON.SceneOptimizer.OptimizeAsync(scene, OptimizerOptions(), null, null);

    updateStatusText();

	return scene;
}; // End of createScene function


// *********************
//  SCENE OPTIMISATION
// *********************
var OptimizerOptions = function () {
    var result = new BABYLON.SceneOptimizerOptions(30, 2000); // limit 30 FPS min here

    var priority = 0;
    result.optimizations.push(new BABYLON.ShadowsOptimization(priority));
    result.optimizations.push(new BABYLON.LensFlaresOptimization(priority));

    // Next priority
    priority++;
    result.optimizations.push(new BABYLON.PostProcessesOptimization(priority));
    result.optimizations.push(new BABYLON.ParticlesOptimization(priority));

    // Next priority
    priority++;
    result.optimizations.push(new BABYLON.TextureOptimization(priority, 256));

    // Next priority
    priority++;
    result.optimizations.push(new BABYLON.RenderTargetsOptimization(priority));

    // Next priority
    priority++;
    result.optimizations.push(new BABYLON.HardwareScalingOptimization(priority, 4));

    return result;
}

// creates the scene
var scene = createScene();

// *********************
//  NETWORK STATUS TEXT
// *********************
function updateStatusText() {
    xhr.open("GET", "https://cashexplorer.bitcoin.com/api/status", true);
    xhr.send();

    xhr.onreadystatechange = function () {
        if (this.readyState == 4 && this.status == 200) {
            let obj = JSON.parse(this.responseText);
            bccStatus.innerHTML = "Network Information<br />"
            bccStatus.innerHTML += "Block Height: " + obj.info.blocks + "<br />";
            bccStatus.innerHTML += "Difficulty: " + obj.info.difficulty;
        }
    }
}

// ******************************
//  NETWORK TRANSACTION INFO TEXT
// ******************************
function updateTxInfoText(mesh) {
    txInfo.innerHTML = "";
    if (mesh != null) {
        if (mesh.sdTransaction) txInfo.innerHTML = "<a href='https://satoshidice.com/' target='_blank'>SatoshiDICE</a> Transaction<br />";
        txInfo.innerHTML += "<a href='https://cashexplorer.bitcoin.com/tx/" + mesh.name + "' target='_blank'>View transaction on cashexplorer.bitcoin.com</a>";
        document.getElementById("showTransaction").value = mesh.name;
    } else {
        txInfo.innerHTML = "";
        document.getElementById("showTransaction").value = "Input Transaction ID to highlight it";
    }
}

// ********************
//  LIGHTING & SHADOWS
// ********************
function setLights() {
    // hemispheric light
    
	var lightHem = new BABYLON.HemisphericLight("Hemispheric", new BABYLON.Vector3(0, 1, 0), scene);
	lightHem.diffuse = new BABYLON.Color3(1, 1, 1);
	lightHem.specular = new BABYLON.Color3(1, 1, 1);
	lightHem.groundColor = new BABYLON.Color3(0,0,0);
    lightHem.intensity = 1;

    // directional light
    var lightDir = new BABYLON.DirectionalLight("Directional", new BABYLON.Vector3(0, -2, -1), scene);
    lightDir.position = new BABYLON.Vector3(0, 5, 5);
    lightDir.specular = new BABYLON.Color3(1,1,1);
    lightDir.intensity = 0.8;

    // shadows
    shadows[0] = new BABYLON.ShadowGenerator(1024, lightDir);
    shadows[0].useBlurExponentialShadowMap = true;
    shadows[0].setTransparencyShadows = true;
}

// ************************
//  MATERIALS AND TEXTURES
// ************************
function setMaterials() {
    let coinTexture = new BABYLON.Texture("assets/textures/coin.png", scene);
    let coinSDTexture = new BABYLON.Texture("assets/textures/sdlogo.png", scene); // satoshi dice logo
    let colorGreen = new BABYLON.Color3(0.298, 0.792, 0.278);
    let colorGrey = new BABYLON.Color3(0.2, 0.2, 0.2);

    // initialise materials
    groundMaterial = new BABYLON.StandardMaterial("ground", scene);
    edgeMaterial = new BABYLON.StandardMaterial("edge", scene);
    sideMaterial = new BABYLON.StandardMaterial("side", scene);
    coinMaterial = new BABYLON.StandardMaterial("coin", scene);
    blockMaterial = new BABYLON.StandardMaterial("block", scene);
    coinDonationMaterial = new BABYLON.StandardMaterial("donation", scene);
    coinSDMaterial = new BABYLON.StandardMaterial("sdCoin", scene);

    //  edge of ground
    edgeMaterial.diffuseColor = colorGrey;
    edgeMaterial.specularColor = BABYLON.Color3.Black();

    groundMaterial.diffuseColor = colorGrey;
    groundMaterial.emissiveColor = colorGrey;
    groundMaterial.specularColor = colorGrey;

    // sides
    sideMaterial.emissiveColor = colorGrey;
    sideMaterial.alpha = 0.1;
    sideMaterial.opacityFresnelParameters = new BABYLON.FresnelParameters();
    sideMaterial.opacityFresnelParameters.leftColor = BABYLON.Color3.White();
    sideMaterial.opacityFresnelParameters.rightColor = BABYLON.Color3.Black();
    sideMaterial.hasAlpha = true;
    sideMaterial.useSpecularOverAlpha = true;

    // coin
    coinMaterial.diffuseTexture = coinTexture;
    coinMaterial.specularColor = colorGreen;
    coinMaterial.specularPower = 64;
    
    // coin donation material
    coinDonationMaterial.diffuseTexture = coinTexture;
    coinDonationMaterial.diffuseColor = new BABYLON.Color3(1, 1, 0);
    coinDonationMaterial.specularColor = colorGreen;
    coinDonationMaterial.specularPower = 64;

    // satoshi dice material
    coinSDMaterial.diffuseTexture = coinSDTexture;
    coinSDMaterial.specularColor = BABYLON.Color3.Black();
    coinSDMaterial.specularPower = 64;

    // block
	blockMaterial.diffuseColor = new BABYLON.Color3(1,0,0);
    blockMaterial.specularColor = new BABYLON.Color3(1, 0, 1);

}

// *******************
//  TRANSACTION INFO
// *******************
function setUI(){
	infoPlane = BABYLON.Mesh.CreatePlane("plane", 3);
	infoPlane.isPickable = false;
    infoPlane.position = new BABYLON.Vector3(0, -3, 0);
    infoPlane.visibility = 0;

	infoPlane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
	infoTexture = BABYLON.GUI.AdvancedDynamicTexture.CreateForMesh(infoPlane,1024,1024,false);
	
	infoRect = new BABYLON.GUI.Rectangle();
	infoRect.height = 0.1;
	infoRect.cornerRadius = 20;
	infoRect.background = "gray";
	infoRect.alpha = 0.5;
	infoRect.parent = infoPlane;
	
	infoText = new BABYLON.GUI.TextBlock();
	infoText.fontSize = 100;
	infoText.alpha = 0.7;
	infoText.color = "white";
	
	infoTexture.addControl(infoRect);	
    infoTexture.addControl(infoText);

    highlight.addExcludedMesh(infoPlane);
}

// ****************************************************
//  CONSTRUCTS SIDES OF THE BOWL FOR LOOKS AND PHYSICS
// ****************************************************
function createSides(numberOfSides, diameter) {

    // constructive solid geometry from cylinders for the sides
	var innerDiameter = diameter;
	var outerDiameter = diameter + 0.1;
	var height = 1;
    var inner = BABYLON.MeshBuilder.CreateCylinder("cone", { height: height, diameter: innerDiameter, tessellation: numberOfSides }, scene);
    var outer = BABYLON.MeshBuilder.CreateCylinder("cone", { height: height, diameter: outerDiameter, tessellation: numberOfSides }, scene);
	var innerCSG = BABYLON.CSG.FromMesh(inner);
    var outerCSG = BABYLON.CSG.FromMesh(outer);
	var subCSG = outerCSG.subtract(innerCSG);
    var newMesh = subCSG.toMesh("sides", sideMaterial, scene);

    newMesh.position.y = -1.25;
    newMesh.material = sideMaterial;
    highlight.addExcludedMesh(newMesh);

    // creates edge around the ground to prevent weird mirror effect
    var newMeshBottom = newMesh.clone("edge");
    newMeshBottom.material = edgeMaterial;
    newMeshBottom.scaling.y = 0.5;
    newMeshBottom.position.y = -2;

    // dispose the temporary meshes
	inner.dispose();
	outer.dispose();

    // adds sides to grounds mirror render list
    groundMaterial.reflectionTexture.renderList.push(newMesh);

    // construct the sides for physics
	var radius = diameter / 2;
	var sides = [];
    var sideParent = BABYLON.Mesh.CreateBox("side", 0, scene);
    
	for (var pt = 0; pt < numberOfSides; pt++){
		var angle = (Math.PI/2) + (pt / numberOfSides) * 2 * Math.PI + (1/numberOfSides * Math.PI);
		var x = radius * Math.cos(angle);
		var z = radius * Math.sin(angle);
		var a = 1.5708 - angle;
		var side = diameter * Math.sin(Math.PI/numberOfSides);

		sides[pt] = sideParent.clone("sides");
		sides[pt].position = new BABYLON.Vector3(x, -1.5, z);
		sides[pt].scaling = new BABYLON.Vector3(0.1, 1.5, side);
		sides[pt].rotation.y = -angle;
		sides[pt].physicsImpostor = new BABYLON.PhysicsImpostor(sides[pt], BABYLON.PhysicsImpostor.BoxImpostor, { mass: 0, restitution: 0.1 }, scene);
        sides[pt].visibility = 0;
        sides[pt].isPickable = false;
        
    }

    // dispose of the side parent as no longer needed
	sideParent.dispose();
}

// *****************************
//  CREATE INITIAL TRANSACTIONS - no longer used
// *****************************
function initialTransactions(data) {
	for (var key in data) {
		var value = data[key].output_total / 100000000;
		var hash = data[key].hash;
		createTransaction(value, hash);
	}
}

// *****************************************************
// CREATE PARENT COIN FOR CLONING WITH NEW TRANSACTIONS
// *****************************************************
function createParentCoin(){
	// uv map for texture location
    var uv = [
        new BABYLON.Vector4(1, 0, 0, 1),
        new BABYLON.Vector4(0.2, 0.2, 0.2, 0.2),
        new BABYLON.Vector4(1, 1, 0, 0)];

	// Colors per surface
    var colors = [
        new BABYLON.Color4(1, 1, 1, 0),
        new BABYLON.Color4(1, 1, 1, 0),
        new BABYLON.Color4(1, 1, 1, 0)];

	// options for coin creation
	var options = {
			height: 0.1,
			diameter: 1,
			subdivisions: 1,
			hasRings: false,
			faceUV: uv,
			faceColors: colors,
			tessellation: 16
	}

	// make coin and add material, physics and shadows
	var coin = BABYLON.MeshBuilder.CreateCylinder("coinParent", options, scene);
	coin.material = coinMaterial;
	coin.position.y = -3;
	coin.rotation.x = 90 * Math.PI/180;

	//coin.showBoundingBox = true;
	coin.receiveShadows = true;
    coin.enabled = false;
    coin.visibility = 0;
	return coin;
}

let transactions = [];
// ***************************************************
//  CLONES PARENT COIN AND POSITIONS/ROTATES NEW COIN
// ***************************************************
function createTransaction(value, txid, vout, size) {
	let x, y, z, w, h, rY, mesh, pr;

    transactions.push(txid);

	// initial random location of coin before they drop
	x = -2 + Math.random() * 4;
	z = -2 + Math.random() * 4;
	y = 5 + Math.random() * 10;

    // set width and playback rate depending on size or value
    if (txRef.checked) {
        w = getCoinWidth(true, size).width;
        pr = getCoinWidth(true, size).playback;
    } else {
        w = getCoinWidth(false, value).width;
        pr = getCoinWidth(false, value).playback;
    }

	// coin height
	h = w / 8;

	// initial rotation
	rY = Math.random() * Math.PI;

	mesh = coinParent.clone(txid);
    mesh.enabled = true;
    mesh.visibility = 1;
	mesh.position = new BABYLON.Vector3(x,y,z);
	mesh.scaling = new BABYLON.Vector3(w,w,w);
    mesh.rotation.y = rY;

    mesh.physicsImpostor = new BABYLON.PhysicsImpostor(mesh, BABYLON.PhysicsImpostor.CylinderImpostor, { mass: w, restitution: 0.1 }, scene);

    mesh.txValue = value;
    mesh.txSize = size;
    
	// add mesh to shadow render list
	for (var i in shadows){
		shadows[i].getShadowMap().renderList.push(mesh);
    }

    // play sound on collision
    mesh.collided = true;
    var impostorList = [];
    scene.meshes.forEach((m) => {
        if (m.physicsImpostor) impostorList.push(m.physicsImpostor);
    });

    mesh.physicsImpostor.registerOnPhysicsCollide(impostorList, function (main, collided) {
        if (main.object.collided == true && !soundMute.checked) {
            soundDrop.setPlaybackRate(pr);
            soundDrop.play();
            main.object.collided = false;
        }
    });

    // add coin to ground mirror render list
    groundMaterial.reflectionTexture.renderList.push(mesh);

    // checks if a transaction is special
    specialTransaction(vout, mesh);
}

// reset coin width based upon size or value
function resetCoinWidths() {
    transactions.forEach((tx) => {
        //console.log(tx + " " + i);
        let t = scene.getMeshByName(tx);
        let w = 1;
        if (txRef.checked) {
            w = getCoinWidth(true, t.txSize).width;
        } else {
            w = getCoinWidth(false, t.txValue).width;
        }

        t.scaling = new BABYLON.Vector3(w, w, w);
        t.physicsImpostor.mass = w;
    });
    //highlightCoin(null);
}


// sets coin width based on value or size
function getCoinWidth(isBytes, value) {
    let w = 1;
    let pr = 1;

    if (!isBytes){
        // diameter of coin depending on value
        if (value < 1) {
            w = .2;
            pr = 1;
        } else if (value >= 1 && value < 10) {
            w = .4;
            pr = 0.9;
        } else if (value >= 10 && value < 50) {
            w = .6;
            pr = 0.8;
        } else if (value >= 50 && value < 100) {
            w = .8;
            pr = 0.7;
        } else if (value >= 100 && value < 200) {
            w = 1;
            pr = 0.6;
        } else if (value >= 200 && value < 500) {
            w = 1.2;
            pr = 0.5;
        } else if (value >= 500 && value < 1000) {
            w = 1.4;
            pr = 0.4;
        } else {
            w = 1.6;
            pr = 0.3;
            }
    } else {
        // diameter of coin depending on size in bytes
        if (value < 300) {
            w = 0.2;
            pr = 1;
        } else if (value >= 300 && value < 500){
            w = 0.4;
            pr = 0.9;
        } else if (value >= 500 && value < 750) {
            w = 0.6;
            pr = 0.8;
        } else if (value >= 750 && value < 1000) {
            w = 0.8;
            pr = 0.7;
        } else if (value >= 1000 && value < 2000) {
            w = 1;
            pr = 0.6;
        } else if (value >= 2000 && value < 3000) {
            w = 1.2;
            pr = 0.5;
        } else if (value >= 3000 && value < 5000) {
            w = 1.4;
            pr = 0.4;
        } else {
            w = 1.6;
            pr = 0.3;
        }
    }

    return {width: w, playback: pr};
}

// *******************************************************
// CHANGES MATERIAL AND PLAYS SOUND FOR SELECTED ADDRESSES
// *******************************************************
function specialTransaction(vout, mesh) {
    // check if coin is sent to donation address and apply a special material
    vout.forEach((key) => {
        var keys = Object.keys(key);
        keys.forEach((k) => {
            if (k == "1BEpW8LnYmBpSFpgJkhPM8Ga7Ry99MPUmE") {
                mesh.material = coinDonationMaterial;
                if (!soundMute.checked) soundDonation.play();
            } else if (
                !disableSD.checked &&
                (k == "1DiceoejxZdTrYwu3FMP2Ldew91jq9L2u" ||
                k == "1Dice115YcjDrPM9gXFW8iFV9S3j9MtERm" ||
                k == "1Dice1FZk6Ls5LKhnGMCLq47tg1DFG763e" ||
                k == "1Dice1cF41TGRLoCTbtN33DSdPtTujzUzx" ||
                k == "1Dice1wBBY22stCobuE1LJxHX5FNZ7U97N" ||
                k == "1Dice2wTatMqebSPsbG4gKgT3HfHznsHWi" ||
                k == "1Dice5ycHmxDHUFVkdKGgrwsDDK1mPES3U" ||
                k == "1Dice7JNVnvzyaenNyNcACuNnRVjt7jBrC" ||
                k == "1Dice7v1M3me7dJGtTX6cqPggwGoRADVQJ" ||
                k == "1Dice81SKu2S1nAzRJUbvpr5LiNTzn7MDV" ||
                k == "1Dice9GgmweQWxqdiu683E7bHfpb7MUXGd")) {

                    mesh.sdTransaction = true;
                    mesh.material = coinSDMaterial;
                    soundSD.setVolume(0.2);
                    if (!soundMute.checked) soundSD.play();
            }
        });
    });
}

// *****************************
//  CREATE BLOCK AND ANIMATE IT
// *****************************
function createBlock(txData) {
	var block = BABYLON.Mesh.CreateBox("block", 1, scene);
	block.material = blockMaterial;
	block.position.y = 3;
	
	var animationBox = new BABYLON.Animation("blockAnimation", "rotation.y", 60, BABYLON.Animation.ANIMATIONTYPE_FLOAT, BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT );
	var keys = [];

	keys.push({frame: 0, value: 0});
	keys.push({frame: 120, value: 8.0});
	
	animationBox.setKeys(keys);
	
	block.animations = [];
	block.animations.push(animationBox);
	
	var animation = scene.beginAnimation(block, 0, 60, false, 1, true);

    // play woosh sound
    if (!soundMute.checked) soundWoosh.play();

    // scale block up from 1 - 4
    BABYLON.Animation.CreateAndStartAnimation('scaleBlockX', block, 'scaling.x', 60, 60, block.scaling.x, 4, BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT);
    BABYLON.Animation.CreateAndStartAnimation('scaleBlockY', block, 'scaling.y', 60, 60, block.scaling.y, 4, BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT);
    BABYLON.Animation.CreateAndStartAnimation('scaleBlockZ', block, 'scaling.z', 60, 60, block.scaling.z, 4, BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT);

    // suck up coins into block
    txData.forEach((tx) => {
        if (scene.getMeshByName(tx)) {
            var coin = scene.getMeshByName(tx);
            BABYLON.Animation.CreateAndStartAnimation('moveCoinX', coin, 'position.x', 60, 60, coin.position.x, block.position.x, BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT);
            BABYLON.Animation.CreateAndStartAnimation('moveCoinY', coin, 'position.y', 60, 60, coin.position.y, block.position.y, BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT);
            BABYLON.Animation.CreateAndStartAnimation('moveCoinZ', coin, 'position.z', 60, 60, coin.position.z, block.position.z, BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT);
        }
    });

    // dispose of block and transactions
    animation.onAnimationEnd = function () {
        animation.animationStarted = false;
        clearTransactions(txData);
        block.dispose();
    }

    
}

// *************************************************
//  CLEAR TRANSACTIONS THAT ARE INCLUDED IN A BLOCK
// *************************************************
function clearTransactions(data) {
    data.forEach((tx) => {
        transactions.forEach((t, i) => {
            if (t == tx) transactions.splice(i,1);
        });
        if (scene.getMeshByName(tx)) scene.getMeshByName(tx).dispose(true);
    });

    // loop through tx not in a block so fall instead of float
    scene.meshes.forEach((m) => {
        if (!m.physicsImpostor) return;
        if (m.name != "ground" && m.name != "sides") m.physicsImpostor.setMass(m.scaling.x);
    });

}

// Register a render loop to repeatedly render the scene
engine.runRenderLoop(function() {
	scene.render();
});

// Watch for browser/canvas resize events
window.addEventListener("resize", function() {
	engine.resize();
});

// when user clicks on a coin
window.addEventListener("click", function () {
    if (event.target != canvas) return;

    var pickResult = scene.pick(scene.pointerX, scene.pointerY);
    var pickedMesh = pickResult.pickedMesh;

    // ignore clicking ground, sides or edge
    if (pickedMesh.name == "ground" || pickedMesh.name == "sides" || pickedMesh.name == "edge") {
        return;

    // remove highlight if clicking the skybox or the same item
    } else if (pickedMesh.name == "skyBox" || pickedMesh == lastPicked) {
        if (lastPicked == null) return;
        highlight.removeMesh(lastPicked);
        lastPicked = null;
        infoPlane.visibility = 0;
        updateTxInfoText(null);
    // highlight picked mesh
    } else {
        highlightCoin(pickedMesh);
        updateTxInfoText(pickedMesh);
    }
    
});

// sets color of coin material
function setCoinColor(orange) {
    if (orange) {
        coinMaterial.diffuseTexture = new BABYLON.Texture("assets/textures/coin_orange.png", scene);
        coinMaterial.specularColor = new BABYLON.Color3(0.9686, 0.5804, 0.1137);
        bccLogo.src = 'assets/images/bccbanner_orange.png';
    } else {
        coinMaterial.diffuseTexture = new BABYLON.Texture("assets/textures/coin.png", scene);
        coinMaterial.specularColor = new BABYLON.Color3(0.298, 0.792, 0.278);
        bccLogo.src = 'assets/images/bccbanner.png';
    }
}

// **************************************
// FOLLOWS TRANSACTIONS TYPED IN TEXTBOX
// **************************************
function followTransaction(id) {
    if (id.length != 64) return;

    // check if searched tx is available
    let isAvailable = false;
    scene.meshes.forEach((mesh) => {
        if (mesh.name == id) {
            highlightCoin(mesh);
            isAvailable = true;
        }
    });

    // search transaction is unconfirmed and create new coin if true
    if (!isAvailable) {    
        xhr.open('GET', "https://bitcoincash.blockexplorer.com/api/tx/" + id, true);
        xhr.send();
        xhr.onreadystatechange = function () {
            if (this.readyState == 4 && this.status == 200) {
                let obj = JSON.parse(this.responseText);
                if (obj.confirmations == 0) {
                    createTransaction(obj.valueOut, id, obj.vout);
                    scene.meshes.forEach((mesh) => {
                        if (mesh.name == id) {
                            highlightCoin(mesh);
                            isAvailable = true;
                        }
                    });
                }    
            }
        }
    }
}

// highlight coin
function highlightCoin(mesh){
    if (lastPicked != null) highlight.removeMesh(lastPicked);

    infoPlane.position.x = mesh.position.x;
    infoPlane.position.z = mesh.position.z;
    infoPlane.position.y = -1;
    infoPlane.visibility = 1;

    if (txRef.checked) {
        var txSize = mesh.txSize.toString() + " bytes";
        infoText.text = txSize;
        
    } else {
        var txVal = mesh.txValue.toString() + " BCH";
        infoText.text = txVal;
    }

    infoRect.width = infoText.text.length / 17;

    highlight.addMesh(mesh, BABYLON.Color3.White());
    lastPicked = mesh;
}

// ***************
// COOKIES
// ***************
window.onload = function () {
    if (getCookie("mute") == "true") soundMute.checked = true;
    if (getCookie("disableSD") == "true") disableSD.checked = true;
    if (getCookie("txRef") == "true") txRef.checked = true;

    if (getCookie("coinColor") == "true") {
        coinColor.checked = true;
        setCoinColor(coinColor.checked);
    }

    // cookie notice
    window.cookieconsent.initialise({
        "palette": {
            "popup": {
                "background": "#000",
                "text": "#4cca47"
            },
            "button": {
                "background": "#4cca47"
            }
        }
    });

};

// event listeners for click changes
coinColor.addEventListener("click", function () {
    setCoinColor(coinColor.checked);
    setCookie("coinColor", this.checked);
});

soundMute.addEventListener("click", function () {
    setCookie("mute", this.checked);
});

disableSD.addEventListener("click", function () {
    setCookie("disableSD", this.checked);
});

txRef.addEventListener("click", function () {
    resetCoinWidths();
    setCookie("txRef", this.checked);
});

// sets a cookie
function setCookie(cname, cvalue, exdays) {
    var d = new Date();
    d.setTime(d.getTime() + (exdays * 24 * 60 * 60 * 1000));
    var expires = "expires=" + d.toUTCString();
    document.cookie = cname + "=" + cvalue + ";" + expires + ";path=/";
}

// gets a cookie
function getCookie(cname) {
    var name = cname + "=";
    var decodedCookie = decodeURIComponent(document.cookie);
    var ca = decodedCookie.split(';');
    for (var i = 0; i < ca.length; i++) {
        var c = ca[i];
        while (c.charAt(0) == ' ') {
            c = c.substring(1);
        }
        if (c.indexOf(name) == 0) {
            return c.substring(name.length, c.length);
        }
    }
    return "";
}

// ************
// PAGE OPTIONS
// ************
//var credits = document.getElementById("help");
function show(e) {
    var element = document.getElementById(e);
    element.style.display = "block";
}
function hide(e) {
    var element = document.getElementById(e);
    element.style.display = "none";
}


function openTab(evt, name) {
    // Declare all variables
    var i, tabcontent, tablinks;

    // Get all elements with class="tabcontent" and hide them
    tabcontent = document.getElementsByClassName("tabcontent");
    for (i = 0; i < tabcontent.length; i++) {
        tabcontent[i].style.display = "none";
    }

    // Get all elements with class="tablinks" and remove the class "active"
    tablinks = document.getElementsByClassName("tablinks");
    for (i = 0; i < tablinks.length; i++) {
        tablinks[i].className = tablinks[i].className.replace(" active", "");
    }

    // Show the current tab, and add an "active" class to the button that opened the tab
    document.getElementById(name).style.display = "block";
    evt.currentTarget.className += " active";
}