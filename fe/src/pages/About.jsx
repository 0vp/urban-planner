function About() {
  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-3xl font-bold text-gray-900 mb-6">About Urban Planner</h1>
      <div className="prose prose-gray">
        <p className="text-gray-600 mb-4">
          Urban Planner is a comprehensive tool designed to help city planners,
          architects, and developers create sustainable and efficient urban environments.
        </p>
        <p className="text-gray-600 mb-4">
          Our platform combines modern technology with urban planning best practices
          to deliver a seamless experience for professionals in the field.
        </p>
        <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-4">Key Features</h2>
        <ul className="list-disc list-inside space-y-2 text-gray-600">
          <li>Interactive map visualization</li>
          <li>Data-driven decision making</li>
          <li>Collaborative workspace</li>
          <li>Real-time updates and notifications</li>
          <li>Comprehensive reporting tools</li>
        </ul>
      </div>
    </div>
  )
}

export default About
