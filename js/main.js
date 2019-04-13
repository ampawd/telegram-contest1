;(function() {	
	// TODO:
	// 1. Finish all features
	// 2. Add mobile support (touch events translation to regular drag events)
	// 3. Investigate for further optimizations (precompute some things)
	// 		3.1. Change text canvas to webgl textures or make existing 2d text canvases heights to be equal font height
	//		3.2. Don't render charts which are currently not visible on the screen
	// 4. Clean up the code
	
	// globals
	let viewWidth  = 0;
	let viewHeight = 0;
	
	let vshader,
		fshader,
		shaderProgram,
		vertexPositionLocation,
		dimensionLoc,
		graphColorLoc;
	
	function compileShader(source, shaderType, gl) {
		let shader = gl.createShader(shaderType);
		gl.shaderSource(shader, source);
		gl.compileShader(shader);

		if (! gl.getShaderParameter(shader, gl.COMPILE_STATUS) ) {
			throw "could not compile shader:" + gl.getShaderInfoLog(shader);
		}
		return shader;
	}

	function getShader(id, gl) {
		let scr = document.getElementById(id);
		let source = scr.text;	
		if (scr.type == "x-shader/x-vertex") {
			return compileShader(source, gl.VERTEX_SHADER, gl);
		} else if (scr.type == "x-shader/x-fragment") {
			return compileShader(source, gl.FRAGMENT_SHADER, gl);	
		}
		return null;
	}
	
	function setUpShaders(gl) {
		vshader = getShader("vshader", gl);
		fshader = getShader("fshader", gl);
		shaderProgram = gl.createProgram();
		gl.attachShader(shaderProgram, vshader);
		gl.attachShader(shaderProgram, fshader);
		gl.linkProgram(shaderProgram);
		gl.useProgram(shaderProgram);	
		gl.deleteShader(fshader);
		gl.deleteShader(vshader);
		xPosLoc = gl.getAttribLocation(shaderProgram, "x");
		yPosLoc = gl.getAttribLocation(shaderProgram, "y");
		gl.enableVertexAttribArray(xPosLoc);
		gl.enableVertexAttribArray(yPosLoc);
		dimensionLoc = gl.getUniformLocation(shaderProgram, "dim");
		transformLoc = gl.getUniformLocation(shaderProgram, "transform");
		graphColorLoc = gl.getUniformLocation(shaderProgram, "graphColor");
	}
	
	function onresize(gl, textCnv) {
		gl.canvas.width = viewWidth;
		gl.canvas.height = viewHeight;		
		textCnv.width = viewWidth;		
		textCnv.height = viewHeight;		
		gl.viewport(0, 0, viewWidth, viewHeight);
	}
	
	function setUpEvents(gl, textCnv) {
		addEventListener("resize", function(e) {
			onresize(gl, textCnv); 
		});
	}
	
	function setUpChartApp(gl, textCnv) {
		gl.clearColor(1.0, 1.0, 1.0, 1.0);
		onresize(gl, textCnv);
		setUpEvents(gl, textCnv);
		setUpShaders(gl);
		gl.canvas.style.left = window.innerWidth*0.5 - parseFloat(gl.canvas.getAttribute("width")*0.5) + "px";
		textCnv.style.left = window.innerWidth*0.5 - parseFloat(textCnv.getAttribute("width")*0.5) + "px";
	}
	
	function hexToRgb(hex) {
		let bigint = parseInt(hex, 16);
		let r = (bigint >> 16) & 255;
		let g = (bigint >> 8) & 255;
		let b = bigint & 255;
		return [r/255, g/255, b/255];
	}
	
	function multMatrices(lhs, rhs) {
		let a = lhs, b = rhs;
		return [
			a[0]*b[0] + a[3]*b[1] + a[6]*b[2],    a[1]*b[0] + a[4]*b[1] + a[7]*b[2],    a[2]*b[0] + a[5]*b[1] + a[8]*b[2],
			a[0]*b[3] + a[3]*b[4] + a[6]*b[5],    a[1]*b[3] + a[4]*b[4] + a[7]*b[5],    a[2]*b[3] + a[5]*b[4] + a[8]*b[5],
			a[0]*b[6] + a[3]*b[7] + a[6]*b[8],    a[1]*b[6] + a[4]*b[7] + a[7]*b[8],    a[2]*b[6] + a[5]*b[7] + a[8]*b[8]
		];
	}
	
	function translate(mat, tx, ty) {		
		mat[0] = mat[4] = mat[8] = 1;
		mat[1] = mat[2] = mat[3] = mat[5] = 0.0;
		mat[6] = tx;
		mat[7] = ty;
	}
	
	function scale(mat, sx, sy) {
		mat[0] = sx;
		mat[1] = mat[2] = mat[3] = mat[5] = mat[6] = mat[7] = 0.0;
		mat[4] = sy;
		mat[8] = 1;
	}
	
	function identity() {
		return [1, 0, 0, 0, 1, 0, 0, 0, 1];
	}
	
	function mapTo(x, a, b, c, d) {
		let denom = b - a;		
		if (Math.abs(denom) > 1e-9) {
			return (x - a)*(d - c)/denom + c;
		}		
		return (c + d)*0.5;
	}
	
	function getYRange(chartData, l, r) {
		let range = {minY: 1e+12, maxY: 1e-12};
		for (let i = 1; i < chartData.columns.length; ++i) {
			for (let j = l; j <= r; ++j) {
				if (chartData.columns[i][j] > range.maxY) {
					range.maxY = chartData.columns[i][j];
				}
				if (chartData.columns[i][j] < range.minY) {
					range.minY = chartData.columns[i][j];
				}
			}
		}
		return range;
	}
	
	function getXRange(chartData) {
		let len = chartData.columns[0].length;
		return {
			minX: chartData.columns[0][1], 
			maxX: chartData.columns[0][len - 1]
		};
	}				
	
	function unixTimeStampToDate(UNIX_timestamp) {
		let a = new Date(UNIX_timestamp);
		let months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
		let month = months[a.getMonth()];
		let date = a.getDate();
		let time = month + ' ' + date;
		return time;
	}
	
	function createChartComponents(gl, ctx, chartData, chartParams, uiParams) {
		//	init buffers
		let vBuff = gl.createBuffer();
		let	linesBuff = gl.createBuffer();		
		let	vertices = [];
		let lineVertices = [];
		let len = chartData.columns[0].length;		
		let yrange = getYRange(chartData, 1, chartData.columns[0].length - 1);
		let xrange = getXRange(chartData);
		let colsLen = chartData.columns.length;
		let graphsCount = colsLen - 1;
		let minX = xrange.minX;	let maxX = xrange.maxX;
		let minY = yrange.minY; let maxY = yrange.maxY;	
		for (let j = 1; j < len; ++j) {
			let x = mapTo(chartData.columns[0][j], minX, maxX, 0, chartParams.width);
			vertices.push(x);
			for (let k = 1; k < colsLen; ++k) {
				let y = mapTo(chartData.columns[k][j], minY, maxY, chartParams.yl, chartParams.yl + chartParams.height);
				vertices.push(y);
			}
		}
		let graphColors = [];
		for (let i in chartData.colors) {
			graphColors.push( hexToRgb(chartData.colors[i].substr(1)) );
		}
		let linesCount = Math.ceil((chartParams.height)/70);
		ctx.font = "9pt verdana, sans-serif";
		ctx.fillStyle = "#666666";

		for (let i = 0; i < linesCount; i++) {
			let y = chartParams.yl + i*70;
			lineVertices.push(0, y, chartParams.width, y);
		}
		// setup buffers
		gl.bindBuffer(gl.ARRAY_BUFFER, linesBuff);
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(lineVertices), gl.STATIC_DRAW);			
		gl.bindBuffer(gl.ARRAY_BUFFER, vBuff);
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
		let numHorLinesPoints = lineVertices.length/2;
		let numGraphPoints = vertices.length/colsLen;
		let stride = 4*colsLen;
		let linesStride = 4*2;
		let offset = 4;
		return {
			renderGraphLines:	
				function(transform2dMatrix, uiParams) {
					gl.uniformMatrix3fv(transformLoc, false, transform2dMatrix);					
					gl.uniform4fv(graphColorLoc, uiParams.linesColor);
					gl.bindBuffer(gl.ARRAY_BUFFER, linesBuff);
					gl.vertexAttribPointer(xPosLoc, 1, gl.FLOAT, false, linesStride, 0);
					gl.vertexAttribPointer(yPosLoc, 1, gl.FLOAT, false, linesStride, 4);
					gl.drawArrays(gl.LINES, 0, numHorLinesPoints);
				},
			renderGraph:
				function(transform2dMatrix, chartIndex) {
					gl.uniform2fv(dimensionLoc, [viewWidth, viewHeight]);
					gl.uniformMatrix3fv(transformLoc, false, transform2dMatrix);					
					gl.bindBuffer(gl.ARRAY_BUFFER, vBuff);					
					gl.vertexAttribPointer(xPosLoc, 1, gl.FLOAT, false, stride, 0);					
					for (let i = 0; i < graphsCount; ++i) {
						gl.uniform4fv(graphColorLoc, [graphColors[i][0], graphColors[i][1], graphColors[i][2], 1]);						
						gl.vertexAttribPointer(yPosLoc, 1, gl.FLOAT, false, stride, (i + 1)*offset);			
						gl.drawArrays(gl.LINE_STRIP, 0, numGraphPoints);
					}
				},
			renderGraphText:
				function(labelXInfo) {
					for (let i = 0; i < linesCount; i++) {
						let y = chartParams.yl + i*70;
						let labelY = mapTo(i*70, 0, chartParams.height, minY, maxY);
						ctx.fillText(parseInt(labelY), 0, viewHeight - y - 10);
					}
					let step = 0;
					//for (let i = labelXInfo.start; step <= chartParams.width; step += 100, i += 2) {
					for (let i = labelXInfo.start; i < labelXInfo.end; step += 100, i += 2) {
						let dateUnix = chartData.columns[0][i];
						let date = unixTimeStampToDate(dateUnix);//.substr(3, 8);
						ctx.fillText(date, 
							step, 
							viewHeight - chartParams.yl + 20
						);
					}
				}
		};
	}
	
	function createChart(gl, ctx, chartData, chartParams, uiParams, index) {
		// let fullViewBlock = document.createElement("div");
		// fullViewBlock.className = "fullView";
		// fullViewBlock.style.width = chartParams.width + "px";
		// fullViewBlock.style.height = chartParams.partViewHeight + "px";
		// fullViewBlock.style.top = (viewHeight - chartParams.yl + 45 ) + "px";
		// fullViewBlock.style.left = parseFloat(gl.canvas.style.left) + "px";	
		// document.body.appendChild(fullViewBlock);	
		
		let partViewBlock = document.createElement("div");
		partViewBlock.className = "partView";
		partViewBlock.setAttribute("data-chart-index", index);
		partViewBlock.style.width = chartParams.width*0.25 + "px";
		partViewBlock.style.height = chartParams.partViewHeight + "px";
		partViewBlock.style.top = (viewHeight - chartParams.yl + 45 ) + "px";
		partViewBlock.style.left = parseFloat(gl.canvas.style.left) + "px";
		document.body.appendChild(partViewBlock);
		
		let chartTitle = document.createElement("div");
		chartTitle.className = "chartTitle";
		chartTitle.style.left = 10 + parseFloat(partViewBlock.style.left) + "px";
		chartTitle.style.top = viewHeight - chartParams.height - chartParams.yl - 70 + "px";
		chartTitle.innerHTML = "Chart #" + index;
		document.body.appendChild(chartTitle);		
		
		let components = createChartComponents(gl, ctx, chartData, chartParams, uiParams);
		return components;
	}
	
	function setNightMode(gl, uiParams, switchMode) {
		let chartTitles = document.getElementsByClassName("chartTitle");
		[].forEach.call(chartTitles, function (title) { title.style.color = "#ddffff"; });
		switchMode.innerHTML = "Switch to Day Mode";
		let col = hexToRgb("#262F3D".substr(1));
		document.body.style.backgroundColor = "#262F3D";
		gl.clearColor(col[0], col[1], col[2], 1.0);
		uiParams.nightMode = 1;
		uiParams.ctx.fillStyle = "#bbbbbb";
		uiParams.linesColor[0] = uiParams.linesColor[1] = uiParams.linesColor[2] = 0.2;
		uiParams.linesColor[3] = 0.25;
	}
	
	function setDayMode(gl, uiParams, switchMode) {
		let chartTitles = document.getElementsByClassName("chartTitle");
		[].forEach.call(chartTitles, function (title) { title.style.color = "#000000"; });
		switchMode.innerHTML = "Switch to Night Mode";
		gl.clearColor(1.0, 1.0, 1.0, 1.0);
		document.body.style.backgroundColor = "#ffffff";
		uiParams.nightMode = 0;
		uiParams.ctx.fillStyle = "#666666";			
		uiParams.linesColor[0] = uiParams.linesColor[1] = uiParams.linesColor[2] = 0;
		uiParams.linesColor[3] = 0.25;
	}
	
	function setUpUi(gl, uiParams) {
		let switchMode = document.getElementById("switchMode");
		let clicked = false;
		switchMode.style.width = 150 + "px";
		switchMode.style.top = 20 + "px";
		switchMode.style.left = window.innerWidth/2 - 150/2 + "px";
		if (uiParams.nightMode) {
			setNightMode(gl, uiParams, switchMode);
		} else {
			setDayMode(gl, uiParams, switchMode);
		}
		switchMode.onclick = function(e) {
			if (clicked) {
				setNightMode(gl, uiParams, switchMode);
			} else {
				setDayMode(gl, uiParams, switchMode);
			}
			clicked = !clicked;
		};
	}
	
	function getBottomViewTransform(chartParams) {
		let T = 			 identity(),
			S = 			 identity(),
			TBack = 		 identity(),
			finalTransform = identity(),
			dx = 0, dy = chartParams.yl;	
		translate(T, dx, -dy);
		translate(TBack, dx, dy - chartParams.partViewHeight);
		scale(S, 1, 0.2);
		finalTransform = multMatrices(T, 	 finalTransform);
		finalTransform = multMatrices(S,  	 finalTransform);
		finalTransform = multMatrices(TBack, finalTransform);
		return finalTransform;
	}
	
	// TODO: this function has a lot of things to precompute...
	function getYScalTransform(animParams, height, chartData) {
		let i = animParams.chartIndex;
		let l = animParams.labelsXInfo[i].start;
		let r = animParams.labelsXInfo[i].end;
		if (l == r) {
			return animParams.finalTransforms[i];
		}
		let yRangeLocal = getYRange(chartData, l, r);
		let yMaxGlobal = getYRange(chartData, 0, chartData.columns[0].length-1).maxY;		
		// let yMaxMaped = mapTo(yRangeLocal.maxY, 0, height, yRangeLocal.minY, yRangeLocal.maxY);
		// let yMinMaped = mapTo(yRangeLocal.minY, 0, height, yRangeLocal.minY, yRangeLocal.maxY);		
		let yl = animParams.yls[i];
		let S = identity();
		let T = identity();
		translate(T, 0, -yl);
		//	finish this
		// console.log(yMaxGlobal);
		// console.log(yRangeLocal.maxY);
		console.log(yMaxGlobal/yRangeLocal.maxY);
		// console.log(animParams.finalTransforms[i][4]);
		// console.log("\n");		
		let t1 = yMaxGlobal/yRangeLocal.maxY;
		let t = animParams.finalTransforms[i][4];		
		if (t < t1) {
			scale(S, 1, 1.05);
		} //else { scale(S, 1, 1); }		
		if (t > t1) {
			scale(S, 1, 0.95);
		} //else { scale(S, 1, 1); }		
		animParams.finalTransforms[i] = multMatrices(T, animParams.finalTransforms[i]);
		animParams.finalTransforms[i] = multMatrices(S, animParams.finalTransforms[i]);		
		translate(T, 0, yl);
		animParams.finalTransforms[i] = multMatrices(T, animParams.finalTransforms[i]);		
		return animParams.finalTransforms[i];
	}
	
	function setPartViewDraggable(cnvLeft, graphWidth, animParams, dateDiffUnix) {
		let T = identity();
		let S = identity();
		//let start = 1, end = 1;
		document.onmousedown = function(e) {
			if (e.target.className == "partView") {
				let x = e.clientX;
				let deltaX = 0;
				let view = e.target;
				let scaleFactor = graphWidth/view.clientWidth;
				let viewLeft = parseFloat(view.style.left);
				let shiftX = x - viewLeft;
				let chartIndex = parseInt(view.getAttribute("data-chart-index"));
				let xrange = animParams.xranges[chartIndex];
				let rightEndBound = 0;
				let rightEndBoundNoViewWidth = cnvLeft + graphWidth;
				let strechFromLeft = false;
				let strechFromRight = false;
				let edgeWidth = 12;
				let viewMinWidth = 25;//graphWidth/16;
				animParams.chartIndex = chartIndex;
				if (e.clientX + 20 >= viewLeft && e.clientX <= viewLeft + edgeWidth) {
					strechFromLeft = true;
				}
				if ((e.clientX >= viewLeft + view.clientWidth - edgeWidth 
					&& e.clientX - 20 <= viewLeft + view.clientWidth)) {
					strechFromRight = true;
				}
				document.onmousemove = function(e) {
					let viewLeftNew = parseFloat(view.style.left);
					deltaX = viewLeftNew - viewLeft;
					viewLeft = viewLeftNew;
					if (strechFromLeft || strechFromRight) {
						x = e.clientX;
						if (strechFromLeft) {
							if (x < cnvLeft) x = cnvLeft;
							if (x + viewMinWidth > rightEndBoundNoViewWidth) {
								x = rightEndBoundNoViewWidth - viewMinWidth;
							}
							if (view.clientWidth > viewMinWidth) {
								view.style.left = x + "px";
								// start = parseInt(
									// (mapTo(x, cnvLeft, cnvLeft + graphWidth, xrange.minX, xrange.maxX) - xrange.minX)/dateDiffUnix
								// );							
							}
							view.style.width = view.clientWidth + (viewLeft - x) + "px";
						} else {
							if (x < cnvLeft) x = cnvLeft;
							if (x > rightEndBoundNoViewWidth) { x = rightEndBoundNoViewWidth; }
							if (x > viewLeft + viewMinWidth) { 
								view.style.width = view.clientWidth + (x - view.clientWidth - viewLeft) + "px";
							}
							// if (view.clientWidth > viewMinWidth) {								
								// end = parseInt(
									// (mapTo(x, cnvLeft, cnvLeft + graphWidth, xrange.minX, xrange.maxX) - xrange.minX)/dateDiffUnix
								// );
							// }
						}
						if (view.clientWidth > viewMinWidth) {
							scaleFactor = graphWidth/view.clientWidth;
							let dx = cnvLeft - viewLeft;
							translate(T, dx, 0);
							scale(S, scaleFactor, 1);
							//animParams.finalTransforms[chartIndex] = identity();
							animParams.finalTransforms[chartIndex] = multMatrices(S, T);
							//animParams.finalTransforms[chartIndex] = multMatrices(S, animParams.finalTransforms[chartIndex]);
						}
						if (view.clientWidth <= viewMinWidth) {
							view.style.width = viewMinWidth + "px";
						}
					} else {
						x = e.clientX - shiftX;
						rightEndBound = rightEndBoundNoViewWidth - view.clientWidth
						if (x < cnvLeft) 		{ x = cnvLeft; }
						if (x > rightEndBound)	{ x = rightEndBound; }
						view.style.left = x + "px";
						let dir = deltaX > 0 ? -1 : 1;
						let dx = dir*Math.abs(scaleFactor*deltaX);
						translate(T, dx, 0);
						animParams.finalTransforms[chartIndex] = multMatrices(T, animParams.finalTransforms[chartIndex]);						
						// convert slider x coordinate into x-axis array start and end indexes
						// start = parseInt(
							// (mapTo(x, cnvLeft, cnvLeft + graphWidth, xrange.minX, xrange.maxX) - xrange.minX)/dateDiffUnix
						// );
						// end = parseInt(
							// (mapTo(x + view.clientWidth, cnvLeft, cnvLeft + graphWidth, xrange.minX, xrange.maxX) - xrange.minX)/dateDiffUnix
						// );
					}
					// animParams.labelsXInfo[chartIndex].start = start + 1;
					// animParams.labelsXInfo[chartIndex].end = end;
				}
				document.onmouseup = function(e) {
					document.onmousemove = null;
					//animParams.chartIndex = -1;
				}
			}
		};
	}
	
/*--------------------------------------	 app entry point	 --------------------------------------*/
	let main = function() {
		let chartsData = JSON.parse(chartsJson);
		let graphsCnv = document.getElementById("chartsView");
		let textCnv = document.getElementById("textView");
		let gl = graphsCnv.getContext("webgl");
		let ctx = textCnv.getContext("2d");
		let timerID = 0;
		let ident = identity();
		let prevYl = 0;
		let charts = [];
		let chartParams = {};
			chartParams.width = window.innerWidth * 0.65;
			chartParams.height = 300;
			chartParams.partViewHeight = chartParams.height*0.5;
		let animParams = { chartIndex: -1, xranges: [], finalTransforms: [], labelsXInfo: [], yls: []};
		let uiParams = {nightMode: 1, ctx: ctx, linesColor: [0, 0, 0, 0.25]};
		viewWidth = chartParams.width;
		viewHeight = chartsData.length * (chartParams.height + chartParams.partViewHeight) * 1.7;
		//viewHeight = 3*(chartParams.height + chartParams.partViewHeight);
		setUpChartApp(gl, textCnv);
		chartParams.cnvLeft = parseFloat(gl.canvas.style.left);
		
		for (let i = 0; i < chartsData.length; ++i) {
			let T = 		 	 identity(),
				S = 			 identity(),
				TBack = 		 identity(),
				finalTransform = identity();
			scale(S, 4, 1);
			finalTransform = multMatrices(S, finalTransform);
			finalTransform = multMatrices(T, finalTransform);
			animParams.finalTransforms[i] = finalTransform.slice();
			chartParams.yl = prevYl ? prevYl - (chartParams.partViewHeight + chartParams.height)*1.6 :
				viewHeight - (chartParams.partViewHeight + chartParams.height);				
			let chart = createChart(gl, ctx, chartsData[i], Object.assign({}, chartParams), uiParams, i);
			let bottomViewTransform = getBottomViewTransform(chartParams);
			charts.push([chart, bottomViewTransform]);
			prevYl = chartParams.yl;
			animParams.xranges.push(getXRange(chartsData[i]));
			animParams.yls[i] = chartParams.yl;
			animParams.labelsXInfo.push({start: 1, end: 1});
		}
		
		let dateDiffUnix = chartsData[0].columns[0][2] - chartsData[0].columns[0][1];
		setPartViewDraggable(chartParams.cnvLeft, chartParams.width, animParams, dateDiffUnix);		
		setUpUi(gl, uiParams);
		
		function renderScene() {
			timerID = requestAnimationFrame(renderScene);
			gl.clear(gl.COLOR_BUFFER_BIT);
			//ctx.clearRect(0, 0, viewWidth, viewHeight);	//	make text canvas height to be textheight size
			// if (animParams.chartIndex >= 0) {
				// animParams.finalTransforms[animParams.chartIndex] = 
					// getYScalTransform(animParams, chartParams.height, chartsData[animParams.chartIndex]);
			// }
			
			for (let i = 0; i < charts.length; ++i) {
				charts[i][0].renderGraphLines(ident, uiParams);
				charts[i][0].renderGraph(animParams.finalTransforms[i], i);
				//charts[i][0].renderGraphText(animParams.labelsXInfo[i]);
				charts[i][0].renderGraph(charts[i][1]);	
			}
		}
		timerID = requestAnimationFrame(renderScene);
	}
	main();
})();