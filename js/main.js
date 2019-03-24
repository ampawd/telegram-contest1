;(function() {
	// globals
	let viewWidth  = window.innerWidth;
	let viewHeight = 0;
	
	let vshader,
		fshader,
		shaderProgram,
		vertexPositionLocation,
		dimensionLoc,
		graphColorLoc;
		
	function onresize(gl, textCnv) {
		gl.canvas.width = viewWidth;
		gl.canvas.height = viewHeight;		
		textCnv.width = viewWidth;		
		textCnv.height = viewHeight;		
		gl.viewport(0, 0, viewWidth, viewHeight);
	}
	
	function compileShader(source, shaderType, gl) {
		let shader = gl.createShader(shaderType);
		gl.shaderSource(shader, source);
		gl.compileShader(shader);

		if ( ! gl.getShaderParameter(shader, gl.COMPILE_STATUS) ) {
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
	}
	
	function hexToRgb(hex) {
		let bigint = parseInt(hex, 16);
		let r = (bigint >> 16) & 255;
		let g = (bigint >> 8) & 255;
		let b = bigint & 255;
		return [r/256, g/256, b/256];
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
		mat[1] = mat[2] = mat[3] = mat[5] = 0.0;
		mat[6] = tx;
		mat[7] = ty;
		mat[0] = 1;
		mat[4] = 1;
		mat[8] = 1;
	}
	
	function scale(mat, sx, sy) {
		mat[1] = mat[2] = mat[3] = mat[5] = mat[6] = mat[7] = 0.0;
		mat[0] = sx;
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
	
	function getYRange(chartData) {
		let len = chartData.columns[0].length;
		let range = {minY: 1e+12, maxY: 1e-12};
		for (let i = 1; i < chartData.columns.length; ++i) {
			for (let j = 1; j < len; ++j) {
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
	
	function unixTimeStampToDate(UNIX_timestamp){
		let a = new Date(UNIX_timestamp);
		let months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
		let month = months[a.getMonth()];
		let date = a.getDate();;
		let time = month + ' ' + date;
		return time;
	}
	
	function createChartComponents(gl, ctx, chartData, chartParams, uiParams) {
		//	init buffers
		let vBuff = gl.createBuffer();
		let	indexBuffer = gl.createBuffer();
		let	linesBuff = gl.createBuffer();		
		let	vertices = [];
		let lineVertices = [];
		let len = chartData.columns[0].length;		
		let yrange = getYRange(chartData);
		let xrange = getXRange(chartData);
		let colsLen = chartData.columns.length;
		let graphsCount = colsLen - 1;
		let minX = xrange.minX;	let maxX = xrange.maxX;
		let minY = yrange.minY; let maxY = yrange.maxY;	
		for (let j = 1; j < len; ++j) {
			let x = mapTo(chartData.columns[0][j], minX, maxX, chartParams.xl, chartParams.xl + chartParams.width);
			vertices.push(x);
			for (let k = 1; k < colsLen; ++k) {
				vertices.push( mapTo(chartData.columns[k][j], minY, maxY, chartParams.yl, chartParams.yl + chartParams.height));
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
			lineVertices.push(chartParams.xl, y, chartParams.xl + chartParams.width, y);
		}
		let datesCount = Math.ceil(chartParams.width/90);
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
					if (transform2dMatrix) {
						gl.uniformMatrix3fv(transformLoc, false, transform2dMatrix);					
					}
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
						ctx.fillText(parseInt(labelY), chartParams.xl + 5, viewHeight - y - 5);
					}
					let step = 0;
					for (let i = labelXInfo.start; step <= chartParams.width; step += 100, i += 2) {
						let dateUnix = chartData.columns[0][i];
						let date = unixTimeStampToDate(dateUnix);//.substr(3, 8);
						ctx.fillText(date, 
							chartParams.xl + step + (date.length > 5 ? -5 : 0), 
							viewHeight - chartParams.yl + 20
						);
					}
				}
		};
	}
	
	function createChart(gl, ctx, chartData, chartParams, uiParams, index) {
		let partViewBlock = document.createElement("div");
		let fullViewBlock = document.createElement("div");
		partViewBlock.className = "partView";
		partViewBlock.setAttribute("data-chart-index", index);
		partViewBlock.style.width = chartParams.width*0.25 + "px";
		partViewBlock.style.height = chartParams.partViewHeight + "px";
		partViewBlock.style.top = (viewHeight - chartParams.yl + 45 ) + "px";
		partViewBlock.style.left = chartParams.xl + "px";
		document.body.appendChild(partViewBlock);		
		let components = createChartComponents(gl, ctx, chartData, chartParams, uiParams);
		return components;
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
	
	function setUpUi(gl, uiParams) {
		let switchMode = document.getElementById("switchMode");
		switchMode.style.width = 150 + "px";
		switchMode.style.top = 20 + "px";
		switchMode.style.left = window.innerWidth/2 - 150/2 + "px";
		clicked = true;
		switchMode.onclick = function(e) {
			if (clicked) {
				this.innerHTML = "Switch to Day Mode";
				let col = hexToRgb("#262F3D".substr(1));
				document.body.style.backgroundColor = "#262F3D";
				gl.clearColor(col[0], col[1], col[2], 1.0);
				uiParams.nightMode = 1;
				uiParams.ctx.fillStyle = "#bbbbbb";
				uiParams.linesColor[0] = uiParams.linesColor[1] = uiParams.linesColor[2] = 0.2;
				uiParams.linesColor[3] = 0.25;
			} else {
				this.innerHTML = "Switch to Night Mode";
				gl.clearColor(1.0, 1.0, 1.0, 1.0);
				document.body.style.backgroundColor = "#ffffff";
				uiParams.nightMode = 0;
				uiParams.ctx.fillStyle = "#666666";			
				uiParams.linesColor[0] = uiParams.linesColor[1] = uiParams.linesColor[2] = 0;
				uiParams.linesColor[3] = 0.25;
			}
			clicked = ! clicked;
		};
	}
	
	function setPartViewDraggable(xl, graphWidth, animParams, dateDiffUnix) {
		let partViewBlockWidth = parseFloat(document.getElementsByClassName("partView")[0].style.width);
		let T = identity();
		document.addEventListener("mousedown", function(e) {
			if (e.target.className == "partView") {
				let view = e.target;
				let startX = e.clientX - parseFloat(view.style.left);				
				let chartIndex = parseInt(view.getAttribute("data-chart-index"));
				let xrange = animParams.xranges[chartIndex];
				let x = 0;
				let deltaX = 0;
				let viewLeft = parseFloat(view.style.left);
				animParams.chartIndex = chartIndex;
				view.style.cursor = "pointer";
				document.onmousemove = function(e) {
					x = e.clientX - startX;					
					deltaX = parseFloat(view.style.left) - viewLeft;
					viewLeft = parseFloat(view.style.left);					
					let sign = deltaX > 0 ? -1 : 1;					
					if (x < xl) {
						x = xl;
					}
					if (x > xl + graphWidth - view.clientWidth) {
						x = xl + graphWidth - view.clientWidth;
					}
					let dx = sign*Math.abs(4*deltaX);
					translate(T, dx, 0);
					animParams.finalTransforms[chartIndex] = multMatrices(T, animParams.finalTransforms[chartIndex]);					
					view.style.left = x + "px";	
					let start = parseInt((mapTo(x, xl, graphWidth, xrange.minX, xrange.maxX) - xrange.minX)/dateDiffUnix);
					animParams.labelsXInfo[chartIndex].start = start + 1;
				}
				document.onmouseup = function(e) {
					document.onmousemove = null; 
					strechFromEdge = false;
				}
			}
		});
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
			chartParams.xl = 0;
			chartParams.width = 750;
			chartParams.height = 300;
			chartParams.partViewHeight = chartParams.height*0.5;
		let animParams = { xranges: [], finalTransforms: [], labelsXInfo: []};
		let uiParams = {nightMode: 0, ctx: ctx, linesColor: [0, 0, 0, 0.25]};		
		viewWidth = chartParams.width;
		viewHeight = chartsData.length * (chartParams.height + chartParams.partViewHeight) * 1.8;
		setUpChartApp(gl, textCnv);			
		
		for (let i = 0; i < chartsData.length; ++i) {
			let T = 		 identity(),
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
			animParams.labelsXInfo.push({start: 1, end: 1});
		}
		
		let dateDiffUnix = chartsData[0].columns[0][2] - chartsData[0].columns[0][1];
		setPartViewDraggable(chartParams.xl, chartParams.width, animParams, dateDiffUnix);		
		function renderScene() {
			timerID = requestAnimationFrame(renderScene);
			gl.clear(gl.COLOR_BUFFER_BIT);
			ctx.clearRect(0, 0, viewWidth, viewHeight);
			for (let i = 0; i < charts.length; ++i) {
				charts[i][0].renderGraphLines(ident, uiParams);
				charts[i][0].renderGraph(animParams.finalTransforms[i], i);
				charts[i][0].renderGraphText(animParams.labelsXInfo[i]);			
				charts[i][0].renderGraph(charts[i][1]);	
			}
		}		
		setUpUi(gl, uiParams);
		timerID = requestAnimationFrame(renderScene);
	}	
	main();
})();