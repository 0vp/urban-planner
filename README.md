so we currently have a radius, and inside, is a urban plan being developed. 

add the following frontend features:
- if user agent is disconnected, add a 'refresh' icon to refresh the connection to the websocket.
- on the left toolbar, add a 'lasso' icon to allow the user to 'paint' on the map to focus on a specific area.

agent:
- add the ability for the agent to understand what is happening inside the region, know the exact location of each building and road AND the names of the road and buildings. (ex. st. catherine street or parliament building).
- using arcgis and other libraries, add the ability to simulate traffic, wind flows, weather patterns, sun coverage (and use the 3D buildings to help predict it throughout the day and seasons etc). these should be visual, and the agent and user should be able to see and understand the simulation and outcomes (ex. traffic congestion between x street and y street). the user should also be able to press a button and simulate the conditions within the lasso'd area or in the entire region if no lasso is drawn.

overall:
- the goal is to allow the agent to run useful simulations and predictions based on the data collected from the region. and then give suggestions on how to improve the urban plan based on the simulation results.
- think like a urban planner and the goals of the city. what tools would be MOST useful to them that they cannot achieve without a agent or memory system (backbaord)